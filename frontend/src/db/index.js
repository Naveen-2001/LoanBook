import Dexie from 'dexie';

const db = new Dexie('LoanBookDB');

db.version(3).stores({
  borrowers: '++id, name, syncId, syncStatus, serverId, _deleted',
  loans: '++id, borrowerId, borrowerSyncId, status, syncId, syncStatus, serverId, _deleted',
  payments: '++id, loanId, loanSyncId, paidDate, syncId, syncStatus, serverId, _deleted',
  settings: 'key',
});

// Handle upgrade errors gracefully
db.open().catch(err => {
  console.error('DB open failed:', err);
  // If schema mismatch, delete and recreate
  if (err.name === 'VersionError') {
    return Dexie.delete('LoanBookDB').then(() => db.open());
  }
});

export default db;
