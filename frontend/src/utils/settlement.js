/**
 * Settlement algorithm — client-side (identical logic to backend).
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
  let y = start.year, m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    months.push(formatMonth(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
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
    const am = typeof a.effectiveFrom === 'string' && a.effectiveFrom.length === 7 ? a.effectiveFrom : dateToMonth(a.effectiveFrom);
    const bm = typeof b.effectiveFrom === 'string' && b.effectiveFrom.length === 7 ? b.effectiveFrom : dateToMonth(b.effectiveFrom);
    return bm.localeCompare(am);
  });
  for (const entry of sorted) {
    const em = typeof entry.effectiveFrom === 'string' && entry.effectiveFrom.length === 7 ? entry.effectiveFrom : dateToMonth(entry.effectiveFrom);
    if (em.localeCompare(month) <= 0) return entry.rate;
  }
  return loan.ratePerMonth;
}

function getPrincipalForMonth(loan, month) {
  let principal = loan.principal;
  for (const r of (loan.principalRepayments || [])) {
    const rm = typeof r.date === 'string' && r.date.length === 7 ? r.date : dateToMonth(r.date);
    if (rm.localeCompare(month) <= 0) principal -= r.amount;
  }
  return Math.max(0, principal);
}

export function getPreviousMonth(monthStr) {
  const { year, month } = parseMonth(monthStr);
  if (month === 1) return formatMonth(year - 1, 12);
  return formatMonth(year, month - 1);
}

export function calculateMonthlyDues(loan, upToMonth) {
  const startMonth = typeof loan.startDate === 'string' && loan.startDate.length === 7 ? loan.startDate : dateToMonth(loan.startDate);
  // Interest for month X is due in month X+1, so dues go up to previous month
  const endMonth = upToMonth || getPreviousMonth(getCurrentMonth());
  if (startMonth.localeCompare(endMonth) > 0) return [];

  // If dateGiven exists, pro-rate the first month
  let proRataFraction = null;
  if (loan.dateGiven) {
    const d = new Date(loan.dateGiven);
    const day = d.getDate();
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - day + 1; // inclusive of given day
    proRataFraction = daysRemaining / daysInMonth;
  }

  return getMonthRange(startMonth, endMonth).map((month, index) => {
    const rate = getRateForMonth(loan, month);
    const principal = getPrincipalForMonth(loan, month);
    let due = principal * (rate / 100);
    // Pro-rate only the first month if dateGiven was provided
    if (index === 0 && proRataFraction !== null) {
      due = due * proRataFraction;
    }
    return { month, due: Math.round(due * 100) / 100 };
  });
}

function buildPaidMap(existingPayments) {
  const map = {};
  for (const p of existingPayments) {
    for (const s of (p.settlements || [])) {
      map[s.forMonth] = (map[s.forMonth] || 0) + s.settledAmount;
    }
  }
  return map;
}

export function settle(loan, existingPayments, newAmount, upToMonth) {
  const dues = calculateMonthlyDues(loan, upToMonth);
  const paid = buildPaidMap(existingPayments);
  const settlements = [];
  let remaining = newAmount;

  // Settle old due first (accumulated unpaid interest from before tracking)
  const oldDue = loan.oldDue || 0;
  if (oldDue > 0) {
    const oldPaid = paid['OLD_DUE'] || 0;
    const oldRemaining = Math.round((oldDue - oldPaid) * 100) / 100;
    if (oldRemaining > 0 && remaining > 0) {
      const settledAmount = Math.min(remaining, oldRemaining);
      const isFull = Math.abs(settledAmount - oldRemaining) < 0.01;
      settlements.push({ forMonth: 'OLD_DUE', dueAmount: oldDue, settledAmount: Math.round(settledAmount * 100) / 100, isFull });
      remaining = Math.round((remaining - settledAmount) * 100) / 100;
    }
  }

  for (const { month, due } of dues) {
    if (remaining <= 0) break;
    const alreadyPaid = paid[month] || 0;
    const monthRemaining = Math.round((due - alreadyPaid) * 100) / 100;
    if (monthRemaining <= 0) continue;
    const settledAmount = Math.min(remaining, monthRemaining);
    const isFull = Math.abs(settledAmount - monthRemaining) < 0.01;
    settlements.push({ forMonth: month, dueAmount: due, settledAmount: Math.round(settledAmount * 100) / 100, isFull });
    remaining = Math.round((remaining - settledAmount) * 100) / 100;
  }
  return { settlements, excess: Math.max(0, remaining) };
}

export function getLoanStatus(loan, payments, upToMonth) {
  const dues = calculateMonthlyDues(loan, upToMonth);
  const paid = buildPaidMap(payments);
  let totalDue = 0, totalPaid = 0, pendingMonths = 0, pendingSince = null;

  // Track old due
  const oldDue = loan.oldDue || 0;
  const oldDuePaid = Math.min(paid['OLD_DUE'] || 0, oldDue);
  const oldDueRemaining = Math.round((oldDue - oldDuePaid) * 100) / 100;
  totalDue += oldDue;
  totalPaid += oldDuePaid;

  const months = dues.map(({ month, due }) => {
    const p = Math.min(paid[month] || 0, due);
    const remaining = Math.round((due - p) * 100) / 100;
    totalDue += due;
    totalPaid += p;
    let status = 'paid';
    if (remaining > 0) {
      status = p > 0 ? 'partial' : 'unpaid';
      pendingMonths++;
      if (!pendingSince) pendingSince = month;
    }
    return { month, due, paid: p, remaining, status };
  });

  let outstandingPrincipal = loan.principal;
  for (const r of (loan.principalRepayments || [])) outstandingPrincipal -= r.amount;
  outstandingPrincipal = Math.max(0, outstandingPrincipal);

  const cm = upToMonth || getCurrentMonth();
  const currentRate = getRateForMonth(loan, cm);
  const currentPrincipal = getPrincipalForMonth(loan, cm);
  const monthlyDue = Math.round(currentPrincipal * (currentRate / 100) * 100) / 100;

  return {
    monthlyDue, months,
    totalDue: Math.round(totalDue * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalPending: Math.round((totalDue - totalPaid) * 100) / 100,
    pendingMonths, pendingSince, outstandingPrincipal,
    oldDue, oldDuePaid, oldDueRemaining,
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
