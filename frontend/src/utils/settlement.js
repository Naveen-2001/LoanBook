/**
 * Settlement algorithm - client-side (kept in sync with backend logic).
 * Enables full offline functionality.
 */

export function getCurrentMonth() {
  const now = new Date();
  return formatMonth(now.getFullYear(), now.getMonth() + 1);
}

export function formatMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return { year, month };
}

export function getMonthRange(startMonth, endMonth) {
  const start = parseMonth(startMonth);
  const end = parseMonth(endMonth);
  const months = [];
  let y = start.year;
  let m = start.month;

  while (y < end.year || (y === end.year && m <= end.month)) {
    months.push(formatMonth(y, m));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return months;
}

export function dateToMonth(date) {
  const d = new Date(date);
  return formatMonth(d.getFullYear(), d.getMonth() + 1);
}

function getRateForMonth(loan, month) {
  const history = loan.rateHistory || [];
  if (history.length === 0) return loan.ratePerMonth;

  const sorted = [...history].sort((a, b) => {
    const aMonth = typeof a.effectiveFrom === 'string' && a.effectiveFrom.length === 7 ? a.effectiveFrom : dateToMonth(a.effectiveFrom);
    const bMonth = typeof b.effectiveFrom === 'string' && b.effectiveFrom.length === 7 ? b.effectiveFrom : dateToMonth(b.effectiveFrom);
    return bMonth.localeCompare(aMonth);
  });

  for (const entry of sorted) {
    const effectiveMonth = typeof entry.effectiveFrom === 'string' && entry.effectiveFrom.length === 7 ? entry.effectiveFrom : dateToMonth(entry.effectiveFrom);
    if (effectiveMonth.localeCompare(month) <= 0) return entry.rate;
  }

  return loan.ratePerMonth;
}

function getPrincipalForMonth(loan, month) {
  let principal = loan.principal;

  for (const repayment of (loan.principalRepayments || [])) {
    const repaymentMonth = typeof repayment.date === 'string' && repayment.date.length === 7 ? repayment.date : dateToMonth(repayment.date);
    if (repaymentMonth.localeCompare(month) <= 0) principal -= repayment.amount;
  }

  return Math.max(0, principal);
}

export function getPreviousMonth(monthStr) {
  const { year, month } = parseMonth(monthStr);
  if (month === 1) return formatMonth(year - 1, 12);
  return formatMonth(year, month - 1);
}

export function getNextMonth(monthStr) {
  const { year, month } = parseMonth(monthStr);
  if (month === 12) return formatMonth(year + 1, 1);
  return formatMonth(year, month + 1);
}

export function calculateMonthlyDues(loan, upToMonth) {
  const baseStartMonth = typeof loan.startDate === 'string' && loan.startDate.length === 7 ? loan.startDate : dateToMonth(loan.startDate);
  const startMonth = loan.dateGiven ? getNextMonth(baseStartMonth) : baseStartMonth;

  let endMonth;
  if (upToMonth) {
    endMonth = upToMonth;
  } else if (loan.dateGiven) {
    // A due month completes each time the monthly anniversary day passes.
    const dueDay = new Date(loan.dateGiven).getDate();
    const currentMonth = getCurrentMonth();
    endMonth = new Date().getDate() >= dueDay ? currentMonth : getPreviousMonth(currentMonth);
  } else {
    // Month-based tracking: interest for month X becomes due in month X+1.
    endMonth = getPreviousMonth(getCurrentMonth());
  }

  if (startMonth.localeCompare(endMonth) > 0) return [];

  return getMonthRange(startMonth, endMonth).map(month => {
    const rate = getRateForMonth(loan, month);
    const principal = getPrincipalForMonth(loan, month);
    const due = principal * (rate / 100);
    return { month, due: Math.round(due * 100) / 100 };
  });
}

function buildPaidMap(existingPayments) {
  const map = {};

  for (const payment of existingPayments) {
    for (const settlement of (payment.settlements || [])) {
      map[settlement.forMonth] = (map[settlement.forMonth] || 0) + settlement.settledAmount;
    }
  }

  return map;
}

export function settle(loan, existingPayments, newAmount, upToMonth) {
  const dues = calculateMonthlyDues(loan, upToMonth);
  const paid = buildPaidMap(existingPayments);
  const settlements = [];
  let remaining = newAmount;

  const oldDue = loan.oldDue || 0;
  if (oldDue > 0) {
    const oldPaid = paid.OLD_DUE || 0;
    const oldRemaining = Math.round((oldDue - oldPaid) * 100) / 100;
    if (oldRemaining > 0 && remaining > 0) {
      const settledAmount = Math.min(remaining, oldRemaining);
      settlements.push({
        forMonth: 'OLD_DUE',
        dueAmount: oldDue,
        settledAmount: Math.round(settledAmount * 100) / 100,
        isFull: Math.abs(settledAmount - oldRemaining) < 0.01,
      });
      remaining = Math.round((remaining - settledAmount) * 100) / 100;
    }
  }

  for (const { month, due } of dues) {
    if (remaining <= 0) break;

    const alreadyPaid = paid[month] || 0;
    const monthRemaining = Math.round((due - alreadyPaid) * 100) / 100;
    if (monthRemaining <= 0) continue;

    const settledAmount = Math.min(remaining, monthRemaining);
    settlements.push({
      forMonth: month,
      dueAmount: due,
      settledAmount: Math.round(settledAmount * 100) / 100,
      isFull: Math.abs(settledAmount - monthRemaining) < 0.01,
    });
    remaining = Math.round((remaining - settledAmount) * 100) / 100;
  }

  return { settlements, excess: Math.max(0, remaining) };
}

export function recalculateAllSettlements(loan, payments, upToMonth) {
  const sorted = [...payments].sort((a, b) => {
    const dateA = new Date(a.paidDate);
    const dateB = new Date(b.paidDate);
    if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
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

export function getLoanStatus(loan, payments, upToMonth) {
  const dues = calculateMonthlyDues(loan, upToMonth);
  const paid = buildPaidMap(payments);
  let totalDue = 0;
  let totalPaid = 0;
  let pendingMonths = 0;
  let pendingSince = null;

  const oldDue = loan.oldDue || 0;
  const oldDuePaid = Math.min(paid.OLD_DUE || 0, oldDue);
  const oldDueRemaining = Math.round((oldDue - oldDuePaid) * 100) / 100;
  totalDue += oldDue;
  totalPaid += oldDuePaid;

  const months = dues.map(({ month, due }) => {
    const paidAmount = Math.min(paid[month] || 0, due);
    const remaining = Math.round((due - paidAmount) * 100) / 100;
    totalDue += due;
    totalPaid += paidAmount;

    let status = 'paid';
    if (remaining > 0) {
      status = paidAmount > 0 ? 'partial' : 'unpaid';
      pendingMonths++;
      if (!pendingSince) pendingSince = month;
    }

    return { month, due, paid: paidAmount, remaining, status };
  });

  let outstandingPrincipal = loan.principal;
  for (const repayment of (loan.principalRepayments || [])) outstandingPrincipal -= repayment.amount;
  outstandingPrincipal = Math.max(0, outstandingPrincipal);

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
    oldDue,
    oldDuePaid,
    oldDueRemaining,
  };
}

export function formatINR(amount) {
  return '₹' + amount.toLocaleString('en-IN');
}

export function monthLabel(monthStr) {
  if (monthStr === 'OLD_DUE') return 'Old Due';
  const d = new Date(monthStr + '-01');
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
