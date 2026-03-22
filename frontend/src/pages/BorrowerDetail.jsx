import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import db from '../db';
import { getLoanStatus, formatINR } from '../utils/settlement';
import ToastContainer, { toast } from '../components/Toast';
import { generateId } from '../utils/uuid';

export default function BorrowerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [borrower, setBorrower] = useState(null);
  const [loans, setLoans] = useState([]);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({ principal: '', ratePerMonth: '', startDate: currentMonth, startMode: 'current', dateGiven: '', notes: '' });
  const [editForm, setEditForm] = useState({ name: '', notes: '' });

  const loadData = useCallback(async () => {
    try {
      const b = await db.borrowers.get(Number(id));
      if (!b) return;
      setBorrower(b);
      setEditForm({ name: b.name, notes: b.notes || '' });

      const allLoans = await db.loans.toArray();
      const bLoans = allLoans.filter(l => String(l.borrowerId) === String(b.id));
      const allPayments = await db.payments.toArray();

      const enriched = bLoans.map(loan => {
        const lPayments = allPayments.filter(p => String(p.loanId) === String(loan.id));
        const status = getLoanStatus(loan, lPayments);
        return { ...loan, ...status };
      });

      setLoans(enriched);
    } catch (err) {
      console.error('BorrowerDetail loadData error:', err);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const addLoan = async () => {
    const principal = Number(form.principal);
    const ratePerMonth = Number(form.ratePerMonth);
    if (!principal || !ratePerMonth || !form.startDate) {
      toast(`Missing: ${!principal ? 'principal ' : ''}${!ratePerMonth ? 'rate ' : ''}${!form.startDate ? 'start date' : ''}`);
      return;
    }

    try {
      const syncId = generateId();
      const notes = [form.notes, form.dateGiven ? `Money given: ${form.dateGiven}` : ''].filter(Boolean).join(' | ');
      await db.loans.add({
        borrowerId: String(borrower.id),
        principal,
        ratePerMonth,
        startDate: form.startDate,
        status: 'active',
        notes,
        rateHistory: [],
        principalRepayments: [],
        syncId,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString(),
      });

      setShowAddLoan(false);
      setForm({ principal: '', ratePerMonth: '', startDate: currentMonth, startMode: 'current', dateGiven: '', notes: '' });
      loadData();
      toast('Loan added');
    } catch (err) {
      toast('Error: ' + err.message);
    }
  };

  const updateBorrower = async () => {
    await db.borrowers.update(Number(id), { name: editForm.name, notes: editForm.notes, syncStatus: 'pending', updatedAt: new Date().toISOString() });
    setShowEdit(false);
    loadData();
    toast('Borrower updated');
  };

  if (!borrower) return <div className="loader"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <button className="back" onClick={() => nav('/')}>&#8249;</button>
        <h1>{borrower.name}</h1>
        <button className="btn btn-small btn-secondary" onClick={() => setShowEdit(true)}>Edit</button>
      </div>
      <div className="page-content">
        {borrower.notes && <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>{borrower.notes}</p>}

        <h3 style={{ fontSize: 15, marginBottom: 12, color: 'var(--text2)' }}>LOANS</h3>

        {loans.length === 0 ? (
          <div className="empty-state">
            <div className="icon">&#128176;</div>
            <p>No loans yet. Tap + to add one.</p>
          </div>
        ) : (
          loans.map(loan => (
            <div key={loan.id} className="card" onClick={() => nav(`/loan/${loan.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="card-title">{formatINR(loan.principal)} @ {loan.ratePerMonth}%/mo</div>
                <span className={`badge ${loan.status === 'closed' ? 'paid' : loan.pendingMonths >= 2 ? 'overdue' : loan.totalPending > 0 ? 'partial' : 'paid'}`}>
                  {loan.status === 'closed' ? 'closed' : loan.pendingMonths >= 2 ? 'overdue' : loan.totalPending > 0 ? 'partial' : 'paid'}
                </span>
              </div>
              <div className="card-subtitle">Since {loan.startDate} · Monthly {formatINR(loan.monthlyDue)}</div>
              <div className="card-row">
                <span className="label">Pending</span>
                <span className="value" style={{ color: loan.totalPending > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {formatINR(loan.totalPending)}
                </span>
              </div>
              <div className="card-row">
                <span className="label">Months due</span>
                <span className="value">{loan.pendingMonths}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <button className="fab" onClick={() => setShowAddLoan(true)}>+</button>

      {showAddLoan && (
        <div className="modal-overlay" onClick={() => setShowAddLoan(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Loan</h3>
            <div className="form-group">
              <label>Principal Amount (₹)</label>
              <input type="number" value={form.principal} onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} placeholder="300000" />
            </div>
            <div className="form-group">
              <label>Rate Per Month (%)</label>
              <input type="number" step="0.1" value={form.ratePerMonth} onChange={e => setForm(f => ({ ...f, ratePerMonth: e.target.value }))} placeholder="2" />
            </div>
            <div className="form-group">
              <label>When was the money given?</label>
              <input type="date" value={form.dateGiven} onChange={e => setForm(f => ({ ...f, dateGiven: e.target.value }))} />
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Optional — for your reference</div>
            </div>
            <div className="form-group">
              <label>Start recording interest from</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className={`btn btn-small ${form.startMode === 'current' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setForm(f => ({ ...f, startMode: 'current', startDate: currentMonth }))} style={{ flex: 1 }}>
                  This Month
                </button>
                <button className={`btn btn-small ${form.startMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setForm(f => ({ ...f, startMode: 'custom', startDate: '' }))} style={{ flex: 1 }}>
                  Custom Month
                </button>
              </div>
              {form.startMode === 'current' ? (
                <div style={{ padding: '12px 16px', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 15 }}>
                  {new Date(currentMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </div>
              ) : (
                <input type="month" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              )}
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {form.startMode === 'current'
                  ? 'Interest tracking starts from this month. Use this for old loans from your book.'
                  : 'Pick the first month interest was due. All months from then till now will show as pending.'}
              </div>
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Loan purpose, etc." />
            </div>
            <button type="button" className="btn btn-primary" onClick={addLoan} disabled={!form.principal || !form.ratePerMonth || !form.startDate}>Add Loan</button>
          </div>
        </div>
      )}

      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Borrower</h3>
            <div className="form-group">
              <label>Name</label>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={updateBorrower}>Save</button>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
