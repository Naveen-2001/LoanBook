const { getMonthRange, getCurrentMonth, compareMonths, dateToMonth } = require('../utils/monthHelpers');

/**
 * Get the applicable interest rate for a given month.
 * Checks rateHistory (sorted by effectiveFrom desc) and falls back to loan.ratePerMonth.
 */
function getRateForMonth(loan, month) {
  if (!loan.rateHistory || loan.rateHistory.length === 0) {
    return loan.ratePerMonth;
  }

  // Sort rate history by effectiveFrom descending
  const sorted = [...loan.rateHistory].sort((a, b) => {
    const aMonth = typeof a.effectiveFrom === 'string' && a.effectiveFrom.length === 7
      ? a.effectiveFrom
      : dateToMonth(a.effectiveFrom);
    const bMonth = typeof b.effectiveFrom === 'string' && b.effectiveFrom.length === 7
      ? b.effectiveFrom
      : dateToMonth(b.effectiveFrom);
    return compareMonths(bMonth, aMonth);
  });

  // Find the most recent rate effective on or before the given month
  for (const entry of sorted) {
    const effectiveMonth = typeof entry.effectiveFrom === 'string' && entry.effectiveFrom.length === 7
      ? entry.effectiveFrom
      : dateToMonth(entry.effectiveFrom);
    if (compareMonths(effectiveMonth, month) <= 0) {
      return entry.rate;
    }
  }

  return loan.ratePerMonth;
}

/**
 * Get the outstanding principal for a given month.
 * Subtracts all principalRepayments made before the start of this month.
 */
function getPrincipalForMonth(loan, month) {
  let principal = loan.principal;

  if (!loan.principalRepayments || loan.principalRepayments.length === 0) {
    return principal;
  }

  for (const repayment of loan.principalRepayments) {
    const repaymentMonth = typeof repayment.date === 'string' && repayment.date.length === 7
      ? repayment.date
      : dateToMonth(repayment.date);
    // Subtract if repayment was made in or before this month (spec: Dec repayment affects Dec onwards)
    if (compareMonths(repaymentMonth, month) <= 0) {
      principal -= repayment.amount;
    }
  }

  return Math.max(0, principal);
}

/**
 * Calculate the interest due for each month of a loan from startDate to currentMonth.
 * Returns an array of { month, due } objects.
 */
function calculateMonthlyDues(loan, upToMonth) {
  const startMonth = typeof loan.startDate === 'string' && loan.startDate.length === 7
    ? loan.startDate
    : dateToMonth(loan.startDate);
  const endMonth = upToMonth || getCurrentMonth();

  if (compareMonths(startMonth, endMonth) > 0) {
    return [];
  }

  const months = getMonthRange(startMonth, endMonth);

  return months.map(month => {
    const rate = getRateForMonth(loan, month);
    const principal = getPrincipalForMonth(loan, month);
    const due = Math.round(principal * (rate / 100) * 100) / 100;
    return { month, due };
  });
}

/**
 * Build a map of how much has already been paid per month from existing payments.
 * Returns { "YYYY-MM": amountPaid }
 */
function buildPaidMap(existingPayments) {
  const paidMap = {};

  for (const payment of existingPayments) {
    if (!payment.settlements) continue;
    for (const s of payment.settlements) {
      paidMap[s.forMonth] = (paidMap[s.forMonth] || 0) + s.settledAmount;
    }
  }

  return paidMap;
}

/**
 * Run the settlement algorithm for a new payment.
 *
 * @param {Object} loan - The loan document
 * @param {Array} existingPayments - All existing payments for this loan (with settlements)
 * @param {Number} newPaymentAmount - The amount of the new payment
 * @param {String} [upToMonth] - Calculate dues up to this month (defaults to current month)
 * @returns {{ settlements: Array, excess: Number }}
 */
function settle(loan, existingPayments, newPaymentAmount, upToMonth) {
  const monthlyDues = calculateMonthlyDues(loan, upToMonth);
  const paidMap = buildPaidMap(existingPayments);

  const settlements = [];
  let remaining = newPaymentAmount;

  for (const { month, due } of monthlyDues) {
    if (remaining <= 0) break;

    const alreadyPaid = paidMap[month] || 0;
    const monthRemaining = Math.round((due - alreadyPaid) * 100) / 100;

    if (monthRemaining <= 0) continue; // Already fully paid

    const settledAmount = Math.min(remaining, monthRemaining);
    const isFull = Math.abs(settledAmount - monthRemaining) < 0.01;

    settlements.push({
      forMonth: month,
      dueAmount: due,
      settledAmount: Math.round(settledAmount * 100) / 100,
      isFull,
    });

    remaining = Math.round((remaining - settledAmount) * 100) / 100;
  }

  return {
    settlements,
    excess: Math.max(0, remaining),
  };
}

/**
 * Recalculate settlements for all payments of a loan in chronological order.
 * Used after deleting a payment to recalculate FIFO order.
 *
 * @param {Object} loan - The loan document
 * @param {Array} payments - All payments sorted by paidDate ascending
 * @param {String} [upToMonth] - Calculate dues up to this month
 * @returns {Array} payments with recalculated settlements
 */
function recalculateAllSettlements(loan, payments, upToMonth) {
  // Sort by paidDate ascending, then by createdAt for same-date payments
  const sorted = [...payments].sort((a, b) => {
    const dateA = new Date(a.paidDate);
    const dateB = new Date(b.paidDate);
    if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  const results = [];
  const priorPayments = [];

  for (const payment of sorted) {
    const { settlements } = settle(loan, priorPayments, payment.amount, upToMonth);
    const updated = { ...payment, settlements };
    results.push(updated);
    priorPayments.push(updated);
  }

  return results;
}

/**
 * Get full loan status with month-by-month breakdown.
 *
 * @param {Object} loan - The loan document
 * @param {Array} payments - All payments for this loan
 * @param {String} [upToMonth] - Calculate up to this month
 * @returns {Object} Full status breakdown
 */
function getLoanStatus(loan, payments, upToMonth) {
  const monthlyDues = calculateMonthlyDues(loan, upToMonth);
  const paidMap = buildPaidMap(payments);

  let totalDue = 0;
  let totalPaid = 0;
  let pendingMonths = 0;
  let pendingSince = null;

  const months = monthlyDues.map(({ month, due }) => {
    const paid = Math.min(paidMap[month] || 0, due);
    const remaining = Math.round((due - paid) * 100) / 100;

    totalDue += due;
    totalPaid += paid;

    let status;
    if (remaining <= 0) {
      status = 'paid';
    } else if (paid > 0) {
      status = 'partial';
      pendingMonths++;
      if (!pendingSince) pendingSince = month;
    } else {
      status = 'unpaid';
      pendingMonths++;
      if (!pendingSince) pendingSince = month;
    }

    return { month, due, paid, remaining, status };
  });

  // Calculate outstanding principal
  let outstandingPrincipal = loan.principal;
  if (loan.principalRepayments) {
    for (const r of loan.principalRepayments) {
      outstandingPrincipal -= r.amount;
    }
  }
  outstandingPrincipal = Math.max(0, outstandingPrincipal);

  // Current monthly due (based on current rate and principal)
  const currentMonth = upToMonth || getCurrentMonth();
  const currentRate = getRateForMonth(loan, currentMonth);
  const currentPrincipal = getPrincipalForMonth(loan, currentMonth);
  const monthlyDue = Math.round(currentPrincipal * (currentRate / 100) * 100) / 100;

  return {
    monthlyDue,
    months,
    totalDue: Math.round(totalDue * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalPending: Math.round((totalDue - totalPaid) * 100) / 100,
    pendingMonths,
    pendingSince,
    outstandingPrincipal,
  };
}

/**
 * Generate a human-readable summary of settlements.
 */
function generateSettlementSummary(settlements, excess) {
  if (settlements.length === 0) {
    return excess > 0
      ? `₹${excess.toLocaleString('en-IN')} excess — no pending dues to settle.`
      : 'No settlements applied.';
  }

  const parts = settlements.map(s => {
    const monthDate = new Date(s.forMonth + '-01');
    const monthName = monthDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    if (s.isFull) {
      return `${monthName} fully settled`;
    }
    return `${monthName} partially settled (₹${s.settledAmount.toLocaleString('en-IN')} of ₹${s.dueAmount.toLocaleString('en-IN')})`;
  });

  const totalSettled = settlements.reduce((sum, s) => sum + s.settledAmount, 0);
  let summary = `₹${totalSettled.toLocaleString('en-IN')} applied: ${parts.join(', ')}`;

  if (excess > 0) {
    summary += `. ₹${excess.toLocaleString('en-IN')} excess.`;
  }

  return summary;
}

module.exports = {
  getRateForMonth,
  getPrincipalForMonth,
  calculateMonthlyDues,
  buildPaidMap,
  settle,
  recalculateAllSettlements,
  getLoanStatus,
  generateSettlementSummary,
};
