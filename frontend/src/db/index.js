import Dexie from 'dexie';

const db = new Dexie('LoanBookDB');

db.version(2).stores({
  borrowers: '++id, name, syncId, syncStatus',
  loans: '++id, borrowerId, status, syncId, syncStatus',
  payments: '++id, loanId, paidDate, syncId, syncStatus',
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
