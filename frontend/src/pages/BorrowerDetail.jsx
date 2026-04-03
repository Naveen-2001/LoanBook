import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import db from '../db';
import { getLoanStatus, formatINR } from '../utils/settlement';
import ToastContainer, { toast } from '../components/Toast';
import { generateId } from '../utils/uuid';
import { loanBelongsToBorrower, paymentBelongsToLoan, normalizeLoanRecord } from '../utils/relations';

export default function BorrowerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [borrower, setBorrower] = useState(null);
  const [loans, setLoans] = useState([]);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({ principal: '', ratePerMonth: '', startDate: currentMonth, startMode: 'current', dateGiven: '', notes: '', paymentFrequency: '1', oldDue: '' });
  const [editForm, setEditForm] = useState({ name: '', notes: '' });

  const loadData = useCallback(async () => {
    try {
      const b = await db.borrowers.get(Number(id));
      if (!b) return;
      setBorrower(b);
      setEditForm({ name: b.name, notes: b.notes || '' });

      const allLoans = (await db.loans.toArray()).filter(l => !l._deleted);
      const bLoans = allLoans.filter(l => loanBelongsToBorrower(l, b));
      const allPayments = (await db.payments.toArray()).filter(p => !p._deleted);

      const enriched = bLoans.map(loan => {
        const lPayments = allPayments.filter(p => paymentBelongsToLoan(p, loan));
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
      await db.loans.add(normalizeLoanRecord({
        borrowerId: borrower.syncId,
        borrowerSyncId: borrower.syncId,
        principal,
        ratePerMonth,
        startDate: form.startDate,
        dateGiven: form.dateGiven || null,
        status: 'active',
        notes: form.notes || '',
        paymentFrequency: Number(form.paymentFrequency) || 1,
        oldDue: Number(form.oldDue) || 0,
        rateHistory: [],
        principalRepayments: [],
        syncId,
        updatedAt: new Date().toISOString(),
      }, {
        syncStatus: 'pending',
        _deleted: false,
        deletedAt: null,
      }));

      setShowAddLoan(false);
      setForm({ principal: '', ratePerMonth: '', startDate: currentMonth, startMode: 'current', dateGiven: '', notes: '', paymentFrequency: '1', oldDue: '' });
      loadData();
      toast('Loan added');
    } catch (err) {
      toast('Error: ' + err.message);
    }
  };

  const updateBorrower = async () => {
    await db.borrowers.update(Number(id), {
      name: editForm.name,
      notes: editForm.notes,
      syncStatus: 'pending',
      updatedAt: new Date().toISOString(),
      _deleted: false,
    });
    setShowEdit(false);
    loadData();
    toast('Borrower updated');
  };

  const deleteBorrower = async () => {
    if (!confirm('Delete this borrower and ALL their loans and payments? This cannot be undone.')) return;
    try {
      const allLoans = await db.loans.toArray();
      const bLoans = allLoans.filter(l => loanBelongsToBorrower(l, borrower));
      const allPayments = await db.payments.toArray();
      for (const loan of bLoans) {
        const lPayments = allPayments.filter(p => paymentBelongsToLoan(p, loan));
        for (const p of lPayments) {
          if (p.serverId) {
            await db.payments.update(p.id, { _deleted: true, syncStatus: 'pending', deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          } else {
            await db.payments.delete(p.id);
          }
        }
        if (loan.serverId) {
          await db.loans.update(loan.id, { _deleted: true, syncStatus: 'pending', deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        } else {
          await db.loans.delete(loan.id);
        }
      }
      if (borrower.serverId) {
        await db.borrowers.update(Number(id), { _deleted: true, syncStatus: 'pending', deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      } else {
        await db.borrowers.delete(Number(id));
      }
      toast('Borrower deleted');
      nav('/');
    } catch (err) {
      toast('Error deleting: ' + err.message);
    }
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
              <div className="card-subtitle">Since {loan.startDate} · {({ 1: 'Monthly', 6: 'Half-yearly', 12: 'Yearly' }[loan.paymentFrequency] || 'Monthly')} · {formatINR(loan.monthlyDue)}/mo</div>
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
              <label>Old Unpaid Due (₹)</label>
              <input type="number" value={form.oldDue} onChange={e => setForm(f => ({ ...f, oldDue: e.target.value }))} placeholder="0" />
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                Accumulated unpaid interest from before tracking starts. Leave 0 if none.
              </div>
            </div>
            <div className="form-group">
              <label>Payment Collection Frequency</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ v: '1', l: 'Monthly' }, { v: '6', l: '6 Months' }, { v: '12', l: 'Yearly' }].map(o => (
                  <button key={o.v} className={`btn btn-small ${form.paymentFrequency === o.v ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setForm(f => ({ ...f, paymentFrequency: o.v }))} style={{ flex: 1 }}>
                    {o.l}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                {form.paymentFrequency === '1' ? 'Interest collected every month' :
                 form.paymentFrequency === '6' ? 'Interest accumulates, collected every 6 months' :
                 'Interest accumulates, collected once a year'}
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
            <button className="btn btn-danger" onClick={deleteBorrower} style={{ marginTop: 12 }}>Delete Borrower</button>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
