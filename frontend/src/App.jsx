import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import PinLock from './components/PinLock';
import { checkDueNotifications } from './utils/notifications';
import Dashboard from './pages/Dashboard';
import BorrowerDetail from './pages/BorrowerDetail';
import LoanDetail from './pages/LoanDetail';
import RecordPayment from './pages/RecordPayment';
import PaymentReceipt from './pages/PaymentReceipt';
import Settings from './pages/Settings';
import './styles.css';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [hasPin, setHasPin] = useState(() => !!localStorage.getItem('loanbook_pin'));

  useEffect(() => {
    // Auto-lock after 2 min in background
    let lockTimer;
    const handleVisibility = () => {
      if (document.hidden) {
        lockTimer = setTimeout(() => setUnlocked(false), 2 * 60 * 1000);
      } else {
        clearTimeout(lockTimer);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(lockTimer);
    };
  }, []);

  // Check for due notifications when app is unlocked
  useEffect(() => {
    if (unlocked) checkDueNotifications();
  }, [unlocked]);

  if (!unlocked) {
    return <PinLock hasPin={hasPin} onUnlock={() => setUnlocked(true)} onSetPin={() => setHasPin(true)} />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/borrower/:id" element={<BorrowerDetail />} />
        <Route path="/loan/:id" element={<LoanDetail />} />
        <Route path="/loan/:id/pay" element={<RecordPayment />} />
        <Route path="/receipt/:id" element={<PaymentReceipt />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
}
