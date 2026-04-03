export function getBorrowerSyncKey(borrower) {
  return borrower?.syncId || String(borrower?.id || '');
}

export function getLoanSyncKey(loan) {
  return loan?.syncId || String(loan?.id || '');
}

export function loanBelongsToBorrower(loan, borrower) {
  const borrowerKey = getBorrowerSyncKey(borrower);
  return String(loan.borrowerSyncId || loan.borrowerId || '') === borrowerKey;
}

export function paymentBelongsToLoan(payment, loan) {
  const loanKey = getLoanSyncKey(loan);
  return String(payment.loanSyncId || payment.loanId || '') === loanKey;
}

export function normalizeBorrowerRecord(borrower, overrides = {}) {
  return {
    ...borrower,
    syncId: borrower.syncId || String(borrower.id || ''),
    syncStatus: borrower.syncStatus || 'synced',
    _deleted: Boolean(borrower._deleted || borrower.deletedAt),
    ...overrides,
  };
}

export function normalizeLoanRecord(loan, overrides = {}) {
  const borrowerSyncId = loan.borrowerSyncId || String(loan.borrowerId || '');
  return {
    ...loan,
    borrowerId: borrowerSyncId,
    borrowerSyncId,
    paymentFrequency: Number(loan.paymentFrequency) || 1,
    oldDue: Number(loan.oldDue) || 0,
    rateHistory: Array.isArray(loan.rateHistory) ? loan.rateHistory : [],
    principalRepayments: Array.isArray(loan.principalRepayments) ? loan.principalRepayments : [],
    syncId: loan.syncId || String(loan.id || ''),
    syncStatus: loan.syncStatus || 'synced',
    _deleted: Boolean(loan._deleted || loan.deletedAt),
    ...overrides,
  };
}

export function normalizePaymentRecord(payment, overrides = {}) {
  const loanSyncId = payment.loanSyncId || String(payment.loanId || '');
  return {
    ...payment,
    loanId: loanSyncId,
    loanSyncId,
    settlements: Array.isArray(payment.settlements) ? payment.settlements : [],
    syncId: payment.syncId || String(payment.id || ''),
    syncStatus: payment.syncStatus || 'synced',
    _deleted: Boolean(payment._deleted || payment.deletedAt),
    ...overrides,
  };
}
