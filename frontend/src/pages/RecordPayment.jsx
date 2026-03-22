import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import db from '../db';
import { settle, formatINR, monthLabel } from '../utils/settlement';
import ToastContainer, { toast } from '../components/Toast';
import { generateId } from '../utils/uuid';

export default function RecordPayment() {
  const { id } = useParams();
  const nav = useNavigate();
  const [loan, setLoan] = useState(null);
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [existingPayments, setExistingPayments] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const l = await db.loans.get(Number(id));
        if (!l) { toast('Loan not found'); nav(-1); return; }
        setLoan(l);
        const allPayments = await db.payments.toArray();
        setExistingPayments(allPayments.filter(p => String(p.loanId) === String(l.id)));
      } catch (err) {
        toast('Error loading loan');
      }
    })();
  }, [id, nav]);

  // Live preview
  useEffect(() => {
    const amt = Number(amount);
    if (!loan || !amt || amt <= 0) { setPreview(null); return; }
    const result = settle(loan, existingPayments, amt);
    setPreview(result);
  }, [amount, loan, existingPayments]);

  const save = async () => {
    const amt = Number(amount);
    if (!amt || !loan || !preview) return;
    setSaving(true);

    try {
      const syncId = generateId();
      const paymentId = await db.payments.add({
        loanId: String(loan.id),
        amount: amt,
        paidDate: new Date(paidDate).toISOString(),
        mode,
        notes,
        settlements: preview.settlements,
        syncId,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString(),
      });

      nav(`/receipt/${paymentId}`, { replace: true });
    } catch (err) {
      setSaving(false);
      toast('Error saving payment: ' + err.message);
    }
  };

  if (!loan) return <div className="loader"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <button className="back" onClick={() => nav(-1)}>&#8249;</button>
        <h1>Record Payment</h1>
      </div>
      <div className="page-content">
        <div className="form-group">
          <label>Amount (₹)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="16000" autoFocus
            style={{ fontSize: 24, fontWeight: 700, padding: '18px 16px' }} />
        </div>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Mode</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['cash', 'upi', 'bank_transfer', 'other'].map(m => (
              <button key={m} className={`btn btn-small ${mode === m ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode(m)} style={{ flex: 1, textTransform: 'capitalize' }}>
                {m === 'bank_transfer' ? 'Bank' : m}
              </button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes..." />
        </div>

        {/* Settlement Preview */}
        {preview && preview.settlements.length > 0 && (
          <div className="settlement-preview">
            <h4 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, letterSpacing: 0.5 }}>SETTLEMENT PREVIEW</h4>
            {preview.settlements.map((s, i) => (
              <div key={i} className="settlement-row">
                <span>{monthLabel(s.forMonth)}</span>
                <span>
                  {formatINR(s.settledAmount)}
                  {s.isFull
                    ? <span className="settlement-check"> ✓</span>
                    : <span className="settlement-partial"> of {formatINR(s.dueAmount)}</span>
                  }
                </span>
              </div>
            ))}
            {preview.excess > 0 && (
              <div style={{ marginTop: 8, color: 'var(--orange)', fontSize: 13 }}>
                {formatINR(preview.excess)} excess — no more pending dues
              </div>
            )}
          </div>
        )}

        {preview && preview.settlements.length === 0 && Number(amount) > 0 && (
          <div style={{ color: 'var(--orange)', fontSize: 13, margin: '12px 0' }}>
            No pending dues to settle. {formatINR(Number(amount))} will be excess.
          </div>
        )}

        <button className="btn btn-primary" onClick={save} disabled={!Number(amount) || saving}
          style={{ marginTop: 16 }}>
          {saving ? 'Saving...' : `Record ${amount ? formatINR(Number(amount)) : ''} Payment`}
        </button>
      </div>
      <ToastContainer />
    </div>
  );
}
