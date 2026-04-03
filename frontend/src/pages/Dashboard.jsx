import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import db from '../db';
import { getLoanStatus, formatINR } from '../utils/settlement';
import { syncToServer, pullFromServer, isLoggedIn } from '../api/client';
import ToastContainer, { toast } from '../components/Toast';
import { generateId } from '../utils/uuid';
import { loanBelongsToBorrower, paymentBelongsToLoan, normalizeBorrowerRecord } from '../utils/relations';

export default function Dashboard() {
  const nav = useNavigate();
  const [borrowers, setBorrowers] = useState([]);
  const [stats, setStats] = useState({ totalLent: 0, totalMonthlyDue: 0, totalPending: 0, totalCollected: 0 });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    try {
    const allBorrowers = (await db.borrowers.toArray()).filter(b => !b._deleted);
    const allLoans = (await db.loans.where('status').equals('active').toArray()).filter(l => !l._deleted);
    const allPayments = (await db.payments.toArray()).filter(p => !p._deleted);

    let totalLent = 0, totalMonthlyDue = 0, totalPending = 0, totalCollected = 0;
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const enriched = allBorrowers.map(b => {
      const bLoans = allLoans.filter(l => loanBelongsToBorrower(l, b));
      let bPending = 0, bPendingMonths = 0, bPendingSince = null, bLastPayment = null;

      for (const loan of bLoans) {
        const lPayments = allPayments.filter(p => paymentBelongsToLoan(p, loan));
        const status = getLoanStatus(loan, lPayments);
        totalLent += loan.principal;
        totalMonthlyDue += status.monthlyDue;
        bPending += status.totalPending;
        bPendingMonths += status.pendingMonths;
        if (status.pendingSince && (!bPendingSince || status.pendingSince < bPendingSince)) bPendingSince = status.pendingSince;

        for (const p of lPayments) {
          const pd = new Date(p.paidDate);
          const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
          if (pm === thisMonth) totalCollected += p.amount;
          if (!bLastPayment || pd > bLastPayment) bLastPayment = pd;
        }
      }

      totalPending += bPending;
      return {
        ...b,
        loanCount: bLoans.length,
        totalPending: bPending,
        pendingMonths: bPendingMonths,
        pendingSince: bPendingSince,
        lastPaymentDate: bLastPayment,
        status: bPendingMonths >= 2 ? 'overdue' : bPending > 0 ? 'partial' : 'paid',
      };
    });

    // Sort: overdue first, then partial, then paid
    const order = { overdue: 0, partial: 1, paid: 2 };
    enriched.sort((a, b) => order[a.status] - order[b.status]);

    setBorrowers(enriched);
    setStats({ totalLent, totalMonthlyDue, totalPending, totalCollected });
    setLoading(false);
    } catch (err) {
      console.error('loadData error:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, [loadData]);

  const handleSync = async () => {
    if (!isLoggedIn()) { toast('Login to server first (Settings)'); return; }
    setSyncing(true);
    const push = await syncToServer();
    const pull = await pullFromServer();
    setSyncing(false);
    if (push.offline || pull.offline) { toast('Offline — sync later'); return; }
    toast(`Synced: ${push.synced} pushed, ${pull.pulled} pulled`);
    loadData();
  };

  const addBorrower = async () => {
    if (!newName.trim()) return;
    try {
      const syncId = generateId();
      await db.borrowers.add(normalizeBorrowerRecord({
        name: newName.trim(),
        notes: newNotes,
        syncId,
        updatedAt: new Date().toISOString(),
      }, {
        syncStatus: 'pending',
        _deleted: false,
        deletedAt: null,
      }));
      setShowAdd(false);
      setNewName('');
      setNewNotes('');
      loadData();
      toast('Borrower added');
    } catch (err) {
      toast('Error: ' + err.message);
    }
  };

  return (
    <div className="page">
      <div className={`sync-bar ${syncing ? 'syncing' : online ? 'online' : 'offline'}`}>
        {syncing ? 'Syncing...' : online ? 'Online' : 'Offline — data saved locally'}
      </div>
      <div className="page-header">
        <h1>LoanBook</h1>
        <button className="btn btn-small btn-secondary" onClick={handleSync} disabled={syncing}>Sync</button>
        <button className="btn btn-small btn-secondary" onClick={() => nav('/settings')}>&#9881;</button>
      </div>
      <div className="page-content">
        <div className="summary-grid">
          <div className="summary-card primary">
            <div className="label">Total Lent</div>
            <div className="value">{formatINR(stats.totalLent)}</div>
          </div>
          <div className="summary-card orange">
            <div className="label">Monthly Due</div>
            <div className="value">{formatINR(stats.totalMonthlyDue)}</div>
          </div>
          <div className="summary-card green">
            <div className="label">Collected (Month)</div>
            <div className="value">{formatINR(stats.totalCollected)}</div>
          </div>
          <div className="summary-card red">
            <div className="label">Total Pending</div>
            <div className="value">{formatINR(stats.totalPending)}</div>
          </div>
        </div>

        {loading ? (
          <div className="loader"><div className="spinner" /></div>
        ) : borrowers.length === 0 ? (
          <div className="empty-state">
            <div className="icon">&#128209;</div>
            <p>No borrowers yet. Tap + to add one.</p>
          </div>
        ) : (
          borrowers.map(b => (
            <div key={b.id} className="card" onClick={() => nav(`/borrower/${b.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="card-title">{b.name}</div>
                  <div className="card-subtitle">
                    {b.loanCount} loan{b.loanCount !== 1 ? 's' : ''}
                    {b.pendingSince && ` · Pending since ${b.pendingSince}`}
                  </div>
                </div>
                <span className={`badge ${b.status}`}>{b.status}</span>
              </div>
              {b.totalPending > 0 && (
                <div className="card-row">
                  <span className="label">Pending</span>
                  <span className="value" style={{ color: 'var(--red)' }}>{formatINR(b.totalPending)}</span>
                </div>
              )}
              {b.lastPaymentDate && (
                <div className="card-row">
                  <span className="label">Last Payment</span>
                  <span className="value" style={{ fontSize: 13 }}>{new Date(b.lastPaymentDate).toLocaleDateString('en-IN')}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <button className="fab" onClick={() => setShowAdd(true)}>+</button>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Borrower</h3>
            <div className="form-group">
              <label>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Borrower name" autoFocus />
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Phone, address, etc." />
            </div>
            <button type="button" className="btn btn-primary" onClick={addBorrower} disabled={!newName.trim()}>Add Borrower</button>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
