import { useState } from 'react';

export default function PinLock({ hasPin, onUnlock, onSetPin }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSettingPin] = useState(!hasPin);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');

  const handleKey = (digit) => {
    setError('');
    const current = isConfirming ? confirmPin : pin;
    if (current.length >= 4) return;
    const next = current + digit;

    if (isConfirming) {
      setConfirmPin(next);
      if (next.length === 4) {
        if (next === pin) {
          localStorage.setItem('loanbook_pin', next);
          onSetPin();
          onUnlock();
        } else {
          setError('PINs do not match');
          setConfirmPin('');
        }
      }
    } else if (isSettingPin) {
      setPin(next);
      if (next.length === 4) {
        setIsConfirming(true);
      }
    } else {
      setPin(next);
      if (next.length === 4) {
        const stored = localStorage.getItem('loanbook_pin');
        if (next === stored) {
          onUnlock();
        } else {
          setError('Wrong PIN');
          setPin('');
        }
      }
    }
  };

  const handleDelete = () => {
    setError('');
    if (isConfirming) {
      setConfirmPin(prev => prev.slice(0, -1));
    } else {
      setPin(prev => prev.slice(0, -1));
    }
  };

  const current = isConfirming ? confirmPin : pin;
  const title = isSettingPin
    ? (isConfirming ? 'Confirm PIN' : 'Set a 4-digit PIN')
    : 'Enter PIN';
  const subtitle = isSettingPin
    ? (isConfirming ? 'Enter the same PIN again' : 'This PIN will lock your LoanBook')
    : 'Unlock to continue';

  return (
    <div className="pin-screen">
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div className="pin-dots">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`pin-dot${i < current.length ? ' filled' : ''}`} />
        ))}
      </div>
      <div className="pin-pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
          <button key={d} className="pin-key" onClick={() => handleKey(String(d))}>{d}</button>
        ))}
        <button className="pin-key empty" />
        <button className="pin-key" onClick={() => handleKey('0')}>0</button>
        <button className="pin-key" onClick={handleDelete} style={{ fontSize: 18 }}>&#9003;</button>
      </div>
      {error && <div className="pin-error">{error}</div>}
    </div>
  );
}
