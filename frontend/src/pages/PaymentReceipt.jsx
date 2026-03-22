import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import db from '../db';
import { getLoanStatus, formatINR, monthLabel } from '../utils/settlement';

export default function PaymentReceipt() {
  const { id } = useParams();
  const nav = useNavigate();
  const [payment, setPayment] = useState(null);
  const [loan, setLoan] = useState(null);
  const [borrower, setBorrower] = useState(null);
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await db.payments.get(Number(id));
      if (!p) return;
      setPayment(p);

      const allLoans = await db.loans.toArray();
      const l = allLoans.find(l => String(l.id) === String(p.loanId));
      setLoan(l);

      if (l) {
        const allBorrowers = await db.borrowers.toArray();
        const b = allBorrowers.find(b => String(b.id) === String(l.borrowerId));
        setBorrower(b);

        const allPayments = await db.payments.toArray();
        const lPayments = allPayments.filter(pay => String(pay.loanId) === String(l.id));
        const status = getLoanStatus(l, lPayments);
        setRemaining(status);
      }
    })();
  }, [id]);

  const generateWhatsAppText = () => {
    if (!payment || !borrower) return '';
    const dateStr = new Date(payment.paidDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    let text = `✅ Payment received\nFrom: ${borrower.name}\nAmount: ${formatINR(payment.amount)} (${payment.mode === 'bank_transfer' ? 'Bank Transfer' : payment.mode.charAt(0).toUpperCase() + payment.mode.slice(1)})\nDate: ${dateStr}\n\nSettlement:`;

    for (const s of (payment.settlements || [])) {
      text += `\n• ${monthLabel(s.forMonth)}: ${formatINR(s.settledAmount)} ${s.isFull ? '✓' : `of ${formatINR(s.dueAmount)}`}`;
    }

    if (remaining) {
      text += `\n\nRemaining dues: ${formatINR(remaining.totalPending)} (${remaining.pendingMonths} months)`;
      if (remaining.pendingSince) text += `\nPending since: ${monthLabel(remaining.pendingSince)}`;
    }

    return text;
  };

  const shareWhatsApp = () => {
    const text = generateWhatsAppText();
    if (!text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const copyText = () => {
    const text = generateWhatsAppText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {},
      () => {} // clipboard API may fail on HTTP
    );
  };

  if (!payment) return <div className="loader"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <button className="back" onClick={() => nav(loan ? `/loan/${loan.id}` : '/')}>&#8249;</button>
        <h1>Receipt</h1>
      </div>
      <div className="page-content">
        <div className="receipt">
          <div className="receipt-header">
            <div style={{ fontSize: 28, color: 'var(--green)' }}>✓</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{formatINR(payment.amount)}</div>
            <div style={{ color: 'var(--text2)', fontSize: 13 }}>Payment Recorded</div>
          </div>

          <div className="receipt-row">
            <span style={{ color: 'var(--text2)' }}>From</span>
            <span style={{ fontWeight: 600 }}>{borrower?.name || '—'}</span>
          </div>
          <div className="receipt-row">
            <span style={{ color: 'var(--text2)' }}>Date</span>
            <span>{new Date(payment.paidDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <div className="receipt-row">
            <span style={{ color: 'var(--text2)' }}>Mode</span>
            <span style={{ textTransform: 'capitalize' }}>{payment.mode === 'bank_transfer' ? 'Bank Transfer' : payment.mode}</span>
          </div>
          {payment.notes && (
            <div className="receipt-row">
              <span style={{ color: 'var(--text2)' }}>Notes</span>
              <span>{payment.notes}</span>
            </div>
          )}

          <hr className="receipt-divider" />

          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, letterSpacing: 0.5 }}>SETTLEMENT BREAKDOWN</div>
          {(payment.settlements || []).map((s, i) => (
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

          {remaining && (
            <>
              <hr className="receipt-divider" />
              <div className="receipt-row">
                <span style={{ color: 'var(--text2)' }}>Remaining Dues</span>
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>{formatINR(remaining.totalPending)}</span>
              </div>
              <div className="receipt-row">
                <span style={{ color: 'var(--text2)' }}>Pending Months</span>
                <span>{remaining.pendingMonths}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={shareWhatsApp} style={{ flex: 1 }}>
            Share on WhatsApp
          </button>
          <button className="btn btn-secondary" onClick={copyText} style={{ flex: 0.5 }}>
            Copy
          </button>
        </div>

        <button className="btn btn-secondary" onClick={() => nav(loan ? `/loan/${loan.id}` : '/')} style={{ marginTop: 10 }}>
          Done
        </button>
      </div>
    </div>
  );
}
