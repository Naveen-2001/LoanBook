import db from '../db';
import {
  normalizeBorrowerRecord,
  normalizeLoanRecord,
  normalizePaymentRecord,
} from '../utils/relations';

const API_URL = localStorage.getItem('loanbook_api_url') || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function getToken() {
  return localStorage.getItem('loanbook_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      localStorage.removeItem('loanbook_token');
      throw new Error('AUTH_EXPIRED');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function login(pin) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  localStorage.setItem('loanbook_token', data.token);
  return data;
}

export function isLoggedIn() {
  return !!getToken();
}

export function logout() {
  localStorage.removeItem('loanbook_token');
}

async function getPendingRecords() {
  const [borrowers, loans, payments] = await Promise.all([
    db.borrowers.where('syncStatus').equals('pending').toArray(),
    db.loans.where('syncStatus').equals('pending').toArray(),
    db.payments.where('syncStatus').equals('pending').toArray(),
  ]);

  return [
    ...borrowers.map(item => ({ ...item, _type: 'borrower' })),
    ...loans.map(item => ({ ...item, _type: 'loan' })),
    ...payments.map(item => ({ ...item, _type: 'payment' })),
  ];
}

function toSyncPayload(item) {
  const base = {
    syncId: item.syncId,
    action: item._deleted ? 'delete' : (item.serverId ? 'update' : 'create'),
    type: item._type,
  };

  if (item._type === 'borrower') {
    return {
      ...base,
      data: {
        name: item.name,
        notes: item.notes || '',
        _deleted: Boolean(item._deleted),
      },
    };
  }

  if (item._type === 'loan') {
    return {
      ...base,
      data: {
        principal: item.principal,
        ratePerMonth: item.ratePerMonth,
        startDate: item.startDate,
        dateGiven: item.dateGiven || null,
        paymentFrequency: Number(item.paymentFrequency) || 1,
        oldDue: Number(item.oldDue) || 0,
        status: item.status || 'active',
        notes: item.notes || '',
        rateHistory: item.rateHistory || [],
        principalRepayments: item.principalRepayments || [],
        borrowerSyncId: item.borrowerSyncId || item.borrowerId,
        _deleted: Boolean(item._deleted),
      },
    };
  }

  return {
    ...base,
    data: {
      amount: item.amount,
      paidDate: item.paidDate,
      mode: item.mode || 'cash',
      notes: item.notes || '',
      photoProofUrl: item.photoProofUrl || '',
      settlements: item.settlements || [],
      loanSyncId: item.loanSyncId || item.loanId,
      _deleted: Boolean(item._deleted),
    },
  };
}

async function applyPushResults(pending, results) {
  for (const result of results) {
    const item = pending.find(entry => entry.syncId === result.syncId);
    if (!item || result.status !== 'ok') continue;

    const table = item._type === 'borrower'
      ? db.borrowers
      : item._type === 'loan'
        ? db.loans
        : db.payments;

    if (item._deleted) {
      await table.delete(item.id);
      continue;
    }

    await table.update(item.id, {
      syncStatus: 'synced',
      serverId: result.serverData?._id || item.serverId || null,
      _deleted: false,
    });
  }
}

function buildBorrowerLookup(borrowers) {
  const byServerId = new Map();
  const bySyncId = new Map();
  for (const borrower of borrowers) {
    if (borrower.serverId) byServerId.set(String(borrower.serverId), borrower);
    if (borrower.syncId) bySyncId.set(String(borrower.syncId), borrower);
  }
  return { byServerId, bySyncId };
}

function buildLoanLookup(loans) {
  const byServerId = new Map();
  const bySyncId = new Map();
  for (const loan of loans) {
    if (loan.serverId) byServerId.set(String(loan.serverId), loan);
    if (loan.syncId) bySyncId.set(String(loan.syncId), loan);
  }
  return { byServerId, bySyncId };
}

async function upsertBorrowers(records) {
  for (const borrower of records) {
    const existing = await db.borrowers.where('syncId').equals(borrower.syncId).first();
    if (borrower.deletedAt) {
      if (existing) await db.borrowers.delete(existing.id);
      continue;
    }

    const localRecord = normalizeBorrowerRecord(borrower, {
      serverId: borrower._id,
      syncStatus: 'synced',
      _deleted: false,
      updatedAt: borrower.updatedAt,
      deletedAt: null,
    });

    if (existing) {
      await db.borrowers.update(existing.id, localRecord);
    } else {
      await db.borrowers.add(localRecord);
    }
  }
}

async function upsertLoans(records) {
  const localBorrowers = await db.borrowers.toArray();
  const borrowerLookup = buildBorrowerLookup(localBorrowers);

  for (const loan of records) {
    const existing = await db.loans.where('syncId').equals(loan.syncId).first();
    if (loan.deletedAt) {
      if (existing) await db.loans.delete(existing.id);
      continue;
    }

    const borrower = borrowerLookup.byServerId.get(String(loan.borrowerId))
      || borrowerLookup.bySyncId.get(String(loan.borrowerId));
    const borrowerSyncId = borrower?.syncId || String(loan.borrowerId);

    const localRecord = normalizeLoanRecord(loan, {
      borrowerId: borrowerSyncId,
      borrowerSyncId,
      serverId: loan._id,
      syncStatus: 'synced',
      _deleted: false,
      updatedAt: loan.updatedAt,
      deletedAt: null,
    });

    if (existing) {
      await db.loans.update(existing.id, localRecord);
    } else {
      await db.loans.add(localRecord);
    }
  }
}

async function upsertPayments(records) {
  const localLoans = await db.loans.toArray();
  const loanLookup = buildLoanLookup(localLoans);

  for (const payment of records) {
    const existing = await db.payments.where('syncId').equals(payment.syncId).first();
    if (payment.deletedAt) {
      if (existing) await db.payments.delete(existing.id);
      continue;
    }

    const loan = loanLookup.byServerId.get(String(payment.loanId))
      || loanLookup.bySyncId.get(String(payment.loanId));
    const loanSyncId = loan?.syncId || String(payment.loanId);

    const localRecord = normalizePaymentRecord(payment, {
      loanId: loanSyncId,
      loanSyncId,
      serverId: payment._id,
      syncStatus: 'synced',
      _deleted: false,
      updatedAt: payment.updatedAt,
      deletedAt: null,
    });

    if (existing) {
      await db.payments.update(existing.id, localRecord);
    } else {
      await db.payments.add(localRecord);
    }
  }
}

export async function syncToServer() {
  const pending = await getPendingRecords();
  if (pending.length === 0) return { synced: 0 };

  try {
    const changes = pending.map(toSyncPayload);
    const result = await request('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    });

    await applyPushResults(pending, result.results);
    return { synced: result.results.filter(entry => entry.status === 'ok').length };
  } catch {
    return { synced: 0, offline: true };
  }
}

export async function pullFromServer() {
  try {
    const lastSync = localStorage.getItem('loanbook_last_sync') || '1970-01-01T00:00:00.000Z';
    const data = await request(`/api/sync/pull?since=${encodeURIComponent(lastSync)}`);

    await upsertBorrowers(data.borrowers || []);
    await upsertLoans(data.loans || []);
    await upsertPayments(data.payments || []);

    localStorage.setItem('loanbook_last_sync', data.serverTimestamp);
    return { pulled: (data.borrowers || []).length + (data.loans || []).length + (data.payments || []).length };
  } catch {
    return { pulled: 0, offline: true };
  }
}

export { request, API_URL };
