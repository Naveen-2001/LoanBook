import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import db from '../db';
import { getLoanStatus, formatINR, monthLabel } from '../utils/settlement';
import ToastContainer, { toast } from '../components/Toast';

export default function LoanDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [loan, setLoan] = useState(null);
  const [status, setStatus] = useState(null);
  const [payments, setPayments] = useState([]);
  const [showRate, setShowRate] = useState(false);
  const [showPrincipal, setShowPrincipal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [rateForm, setRateForm] = useState({ newRate: '', effectiveFrom: '' });
  const [principalForm, setPrincipalForm] = useState({ amount: '', notes: '' });
  const [editForm, setEditForm] = useState({ principal: '', ratePerMonth: '', startDate: '', dateGiven: '', notes: '' });
  const [expandedPayment, setExpandedPayment] = useState(null);

  const loadData = useCallback(async () => {
    const l = await db.loans.get(Number(id));
    if (!l) return;
    setLoan(l);
    setEditForm({
      principal: String(l.principal),
      ratePerMonth: String(l.ratePerMonth),
      startDate: l.startDate,
      dateGiven: l.notes?.match(/Money given: (\S+)/)?.[1] || '',
      notes: (l.notes || '').replace(/\s*\|\s*Money given: \S+/, '').replace(/Money given: \S+\s*\|?\s*/, ''),
    });

    const allPayments = await db.payments.toArray();
    const lPayments = allPayments.filter(p => String(p.loanId) === String(l.id));
    const s = getLoanStatus(l, lPayments);
    setStatus(s);

    // Sort newest first for display
    lPayments.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
    setPayments(lPayments);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const changeRate = async () => {
    const newRate = Number(rateForm.newRate);
    if (!newRate || !rateForm.effectiveFrom) return;
    const existingHistory = loan.rateHistory || [];
    // If first rate change, preserve original rate in history
    const history = existingHistory.length === 0
      ? [{ rate: loan.ratePerMonth, effectiveFrom: loan.startDate }, { rate: newRate, effectiveFrom: rateForm.effectiveFrom }]
      : [...existingHistory, { rate: newRate, effectiveFrom: rateForm.effectiveFrom }];
    // Do NOT update ratePerMonth — it stays as original base rate
    await db.loans.update(Number(id), { rateHistory: history, syncStatus: 'pending', updatedAt: new Date().toISOString() });
    setShowRate(false);
    setRateForm({ newRate: '', effectiveFrom: '' });
    loadData();
    toast('Rate changed');
  };

  const repayPrincipal = async () => {
    const amount = Number(principalForm.amount);
    if (!amount) return;
    const repayments = [...(loan.principalRepayments || []), { amount, date: new Date().toISOString(), notes: principalForm.notes }];
    await db.loans.update(Number(id), { principalRepayments: repayments, syncStatus: 'pending', updatedAt: new Date().toISOString() });
    setShowPrincipal(false);
    setPrincipalForm({ amount: '', notes: '' });
    loadData();
    toast('Principal repayment recorded');
  };

  const closeLoan = async () => {
    if (!confirm('Close this loan?')) return;
    await db.loans.update(Number(id), { status: 'closed', syncStatus: 'pending', updatedAt: new Date().toISOString() });
    loadData();
    toast('Loan closed');
  };

  const deletePayment = async (paymentId) => {
    if (!confirm('Delete this payment? Settlements will be recalculated.')) return;
    try {
      await db.payments.delete(paymentId);
      setExpandedPayment(null);
      loadData();
      toast('Payment deleted');
    } catch (err) {
      toast('Error deleting: ' + err.message);
    }
  };

  const updateLoan = async () => {
    const principal = Number(editForm.principal);
    const ratePerMonth = Number(editForm.ratePerMonth);
    if (!principal || !ratePerMonth || !editForm.startDate) { toast('Fill required fields'); return; }
    const notes = [editForm.notes, editForm.dateGiven ? `Money given: ${editForm.dateGiven}` : ''].filter(Boolean).join(' | ');
    await db.loans.update(Number(id), { principal, ratePerMonth, startDate: editForm.startDate, notes, syncStatus: 'pending', updatedAt: new Date().toISOString() });
    setShowEdit(false);
    loadData();
    toast('Loan updated');
  };

  if (!loan || !status) return <div className="loader"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <button className="back" onClick={() => nav(-1)}>&#8249;</button>
        <h1>Loan Details</h1>
        <button className="btn btn-small btn-secondary" onClick={() => setShowEdit(true)}>Edit</button>
      </div>
      <div className="page-content">
        {/* Summary */}
        <div className="card" style={{ background: 'var(--surface2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{formatINR(loan.principal)}</div>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>{loan.ratePerMonth}%/mo · Since {loan.startDate}</div>
            </div>
            <span className={`badge ${loan.status === 'closed' ? 'paid' : status.pendingMonths >= 2 ? 'overdue' : 'partial'}`}>
              {loan.status === 'closed' ? 'closed' : status.pendingMonths >= 2 ? 'overdue' : status.totalPending > 0 ? 'partial' : 'paid'}
            </span>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card green">
            <div className="label">Total Paid</div>
            <div className="value">{formatINR(status.totalPaid)}</div>
          </div>
          <div className="summary-card red">
            <div className="label">Total Pending</div>
            <div className="value">{formatINR(status.totalPending)}</div>
          </div>
          <div className="summary-card orange">
            <div className="label">Months Due</div>
            <div className="value">{status.pendingMonths}</div>
          </div>
          <div className="summary-card primary">
            <div className="label">Outstanding Principal</div>
            <div className="value">{formatINR(status.outstandingPrincipal)}</div>
          </div>
        </div>

        {status.pendingSince && (
          <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>
            Pending since {monthLabel(status.pendingSince)}
          </p>
        )}

        {/* Month Grid */}
        <h3 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, letterSpacing: 0.5 }}>MONTH-BY-MONTH</h3>
        <div className="month-grid">
          {status.months.map(m => (
            <div key={m.month} className={`month-cell ${m.status}`}>
              <div className="month-label">{monthLabel(m.month)}</div>
              <div>{m.status === 'paid' ? '✓' : m.status === 'partial' ? formatINR(m.remaining) : formatINR(m.due)}</div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
          <button className="btn btn-small btn-secondary" onClick={() => setShowRate(true)}>Change Rate</button>
          <button className="btn btn-small btn-secondary" onClick={() => setShowPrincipal(true)}>Repay Principal</button>
          {loan.status === 'active' && <button className="btn btn-small btn-danger" onClick={closeLoan}>Close</button>}
        </div>

        {/* Payments */}
        <h3 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, marginTop: 24, letterSpacing: 0.5 }}>PAYMENT HISTORY</h3>
        {payments.length === 0 ? (
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>No payments yet</p>
        ) : (
          payments.map(p => (
            <div key={p.id} className="card" onClick={() => setExpandedPayment(expandedPayment === p.id ? null : p.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div className="card-title">{formatINR(p.amount)}</div>
                  <div className="card-subtitle">{new Date(p.paidDate).toLocaleDateString('en-IN')} · {p.mode}</div>
                </div>
                <span style={{ color: 'var(--text2)', fontSize: 20 }}>{expandedPayment === p.id ? '▴' : '▾'}</span>
              </div>
              {expandedPayment === p.id && (
                <div style={{ marginTop: 12 }}>
                  {(p.settlements || []).map((s, i) => (
                    <div key={i} className="settlement-row">
                      <span>{monthLabel(s.forMonth)}</span>
                      <span>
                        {formatINR(s.settledAmount)}
                        {s.isFull
                          ? <span className="settlement-check"> ✓</span>
                          : <span className="settlement-partial"> / {formatINR(s.dueAmount)}</span>
                        }
                      </span>
                    </div>
                  ))}
                  {p.notes && <p style={{ color: 'var(--text2)', fontSize: 12, marginTop: 8 }}>{p.notes}</p>}
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button className="btn btn-small btn-secondary" onClick={(e) => { e.stopPropagation(); nav(`/receipt/${p.id}`); }}>Receipt</button>
                    <button className="btn btn-small btn-danger" onClick={(e) => { e.stopPropagation(); deletePayment(p.id); }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {loan.status === 'active' && (
        <button className="fab" onClick={() => nav(`/loan/${id}/pay`)}>₹</button>
      )}

      {/* Change Rate Modal */}
      {showRate && (
        <div className="modal-overlay" onClick={() => setShowRate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Change Interest Rate</h3>
            <div className="form-group">
              <label>New Rate (%/month)</label>
              <input type="number" step="0.1" value={rateForm.newRate} onChange={e => setRateForm(f => ({ ...f, newRate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Effective From</label>
              <input type="month" value={rateForm.effectiveFrom} onChange={e => setRateForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={changeRate} disabled={!rateForm.newRate || !rateForm.effectiveFrom}>Change Rate</button>
          </div>
        </div>
      )}

      {/* Repay Principal Modal */}
      {showPrincipal && (
        <div className="modal-overlay" onClick={() => setShowPrincipal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Repay Principal</h3>
            <div className="form-group">
              <label>Amount (₹)</label>
              <input type="number" value={principalForm.amount} onChange={e => setPrincipalForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea value={principalForm.notes} onChange={e => setPrincipalForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={repayPrincipal} disabled={!principalForm.amount}>Record Repayment</button>
          </div>
        </div>
      )}

      {/* Edit Loan Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Loan</h3>
            <div className="form-group">
              <label>Principal Amount (₹)</label>
              <input type="number" value={editForm.principal} onChange={e => setEditForm(f => ({ ...f, principal: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Rate Per Month (%)</label>
              <input type="number" step="0.1" value={editForm.ratePerMonth} onChange={e => setEditForm(f => ({ ...f, ratePerMonth: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Start Month</label>
              <input type="month" value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Date Money Given</label>
              <input type="date" value={editForm.dateGiven} onChange={e => setEditForm(f => ({ ...f, dateGiven: e.target.value }))} />
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Optional — for your reference</div>
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={updateLoan} disabled={!editForm.principal || !editForm.ratePerMonth || !editForm.startDate}>Save</button>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
