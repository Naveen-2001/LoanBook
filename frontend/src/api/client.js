import db from '../db';

const API_URL = localStorage.getItem('loanbook_api_url') || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function getToken() {
  return localStorage.getItem('loanbook_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

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

// ─── Offline-first CRUD ───

export async function syncToServer() {
  const pending = [
    ...(await db.borrowers.where('syncStatus').equals('pending').toArray()).map(d => ({ ...d, _type: 'borrower' })),
    ...(await db.loans.where('syncStatus').equals('pending').toArray()).map(d => ({ ...d, _type: 'loan' })),
    ...(await db.payments.where('syncStatus').equals('pending').toArray()).map(d => ({ ...d, _type: 'payment' })),
  ];

  if (pending.length === 0) return { synced: 0 };

  try {
    const changes = pending.map(item => ({
      type: item._type,
      action: item._deleted ? 'delete' : (item.serverId ? 'update' : 'create'),
      data: item,
      syncId: item.syncId,
    }));

    const result = await request('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    });

    // Mark as synced
    for (const r of result.results) {
      if (r.status === 'ok') {
        const item = pending.find(p => p.syncId === r.syncId);
        if (item) {
          const table = item._type === 'borrower' ? db.borrowers : item._type === 'loan' ? db.loans : db.payments;
          await table.update(item.id, { syncStatus: 'synced', serverId: r.serverData?._id });
        }
      }
    }

    return { synced: result.results.filter(r => r.status === 'ok').length };
  } catch {
    return { synced: 0, offline: true };
  }
}

export async function pullFromServer() {
  try {
    const lastSync = localStorage.getItem('loanbook_last_sync') || '1970-01-01T00:00:00.000Z';
    const data = await request(`/api/sync/pull?since=${lastSync}`);

    for (const b of data.borrowers) {
      const existing = await db.borrowers.where('syncId').equals(b.syncId).first();
      if (existing) {
        await db.borrowers.update(existing.id, { ...b, syncStatus: 'synced', serverId: b._id });
      } else {
        await db.borrowers.add({ ...b, syncStatus: 'synced', serverId: b._id });
      }
    }
    for (const l of data.loans) {
      const existing = await db.loans.where('syncId').equals(l.syncId).first();
      if (existing) {
        await db.loans.update(existing.id, { ...l, syncStatus: 'synced', serverId: l._id });
      } else {
        await db.loans.add({ ...l, syncStatus: 'synced', serverId: l._id });
      }
    }
    for (const p of data.payments) {
      const existing = await db.payments.where('syncId').equals(p.syncId).first();
      if (existing) {
        await db.payments.update(existing.id, { ...p, syncStatus: 'synced', serverId: p._id });
      } else {
        await db.payments.add({ ...p, syncStatus: 'synced', serverId: p._id });
      }
    }

    localStorage.setItem('loanbook_last_sync', data.serverTimestamp);
    return { pulled: data.borrowers.length + data.loans.length + data.payments.length };
  } catch {
    return { pulled: 0, offline: true };
  }
}

export { request, API_URL };
