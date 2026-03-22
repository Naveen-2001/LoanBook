import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import db from '../db';
import { login, logout, isLoggedIn, syncToServer, pullFromServer } from '../api/client';
import ToastContainer, { toast } from '../components/Toast';

export default function Settings() {
  const nav = useNavigate();
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [pin, setPin] = useState('');
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('loanbook_api_url') || 'http://localhost:3001');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSync, setLastSync] = useState(localStorage.getItem('loanbook_last_sync') || 'Never');
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    (async () => {
      const pending = (await db.borrowers.where('syncStatus').equals('pending').count())
        + (await db.loans.where('syncStatus').equals('pending').count())
        + (await db.payments.where('syncStatus').equals('pending').count());
      setPendingCount(pending);
    })();
  }, []);

  const handleLogin = async () => {
    if (!pin) return;
    try {
      await login(pin);
      setLoggedIn(true);
      setPin('');
      toast('Logged in to server');
    } catch (err) {
      toast(err.message === 'Invalid PIN' ? 'Wrong server PIN' : 'Connection failed');
    }
  };

  const handleLogout = () => {
    logout();
    setLoggedIn(false);
    toast('Logged out');
  };

  const handleFullSync = async () => {
    if (!loggedIn) { toast('Login first'); return; }
    toast('Syncing...');
    const push = await syncToServer();
    const pull = await pullFromServer();
    if (push.offline) { toast('Offline'); return; }
    toast(`Done: ${push.synced} pushed, ${pull.pulled} pulled`);

    const pending = (await db.borrowers.where('syncStatus').equals('pending').count())
      + (await db.loans.where('syncStatus').equals('pending').count())
      + (await db.payments.where('syncStatus').equals('pending').count());
    setPendingCount(pending);
    setLastSync(localStorage.getItem('loanbook_last_sync'));
  };

  const saveApiUrl = () => {
    localStorage.setItem('loanbook_api_url', apiUrl);
    toast('API URL saved — reload app to apply');
  };

  const changeAppPin = () => {
    if (newPin.length !== 4) { toast('PIN must be 4 digits'); return; }
    localStorage.setItem('loanbook_pin', newPin);
    setShowChangePin(false);
    setNewPin('');
    toast('App PIN changed');
  };

  const exportData = async () => {
    const borrowers = await db.borrowers.toArray();
    const loans = await db.loans.toArray();
    const payments = await db.payments.toArray();

    const data = JSON.stringify({ borrowers, loans, payments, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loanbook-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  };

  const importData = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.borrowers || !data.loans || !data.payments) {
        toast('Invalid backup file');
        return;
      }

      if (!confirm(`Import ${data.borrowers.length} borrowers, ${data.loans.length} loans, ${data.payments.length} payments? This will REPLACE all local data.`)) return;

      await db.borrowers.clear();
      await db.loans.clear();
      await db.payments.clear();
      await db.borrowers.bulkAdd(data.borrowers.map(b => ({ ...b, id: undefined })));
      await db.loans.bulkAdd(data.loans.map(l => ({ ...l, id: undefined })));
      await db.payments.bulkAdd(data.payments.map(p => ({ ...p, id: undefined })));

      e.target.value = '';
      toast('Data restored successfully');
    } catch {
      e.target.value = '';
      toast('Failed to import — invalid file');
    }
  };

  const clearAllData = async () => {
    if (!confirm('DELETE ALL DATA? This cannot be undone!')) return;
    if (!confirm('Are you sure? Export a backup first if needed.')) return;
    await db.borrowers.clear();
    await db.loans.clear();
    await db.payments.clear();
    toast('All data cleared');
  };

  return (
    <div className="page">
      <div className="page-header">
        <button className="back" onClick={() => nav('/')}>&#8249;</button>
        <h1>Settings</h1>
      </div>
      <div className="page-content">
        {/* Server Connection */}
        <h3 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, letterSpacing: 0.5 }}>SERVER</h3>

        <div className="form-group">
          <label>API URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-small btn-secondary" onClick={saveApiUrl}>Save</button>
          </div>
        </div>

        {!loggedIn ? (
          <div className="form-group">
            <label>Server PIN</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="1234" style={{ flex: 1 }} />
              <button className="btn btn-small btn-primary" onClick={handleLogin}>Login</button>
            </div>
          </div>
        ) : (
          <div className="setting-item">
            <div>
              <div className="label" style={{ color: 'var(--green)' }}>Connected to server</div>
              <div className="desc">Last sync: {lastSync === 'Never' ? 'Never' : new Date(lastSync).toLocaleString('en-IN')}</div>
              <div className="desc">Pending changes: {pendingCount}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-small btn-primary" onClick={handleFullSync}>Sync</button>
              <button className="btn btn-small btn-secondary" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        )}

        {/* Security */}
        <h3 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, marginTop: 24, letterSpacing: 0.5 }}>SECURITY</h3>

        <div className="setting-item" onClick={() => setShowChangePin(true)} style={{ cursor: 'pointer' }}>
          <div>
            <div className="label">Change App PIN</div>
            <div className="desc">Change the PIN used to unlock this app</div>
          </div>
          <span style={{ color: 'var(--text2)' }}>&#8250;</span>
        </div>

        {showChangePin && (
          <div style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>New 4-digit PIN</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="password" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} style={{ flex: 1 }} />
                <button className="btn btn-small btn-primary" onClick={changeAppPin}>Set</button>
              </div>
            </div>
          </div>
        )}

        {/* Backup & Restore */}
        <h3 style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, marginTop: 24, letterSpacing: 0.5 }}>DATA</h3>

        <div className="setting-item" onClick={exportData} style={{ cursor: 'pointer' }}>
          <div>
            <div className="label">Export Backup</div>
            <div className="desc">Download all data as JSON file</div>
          </div>
          <span style={{ color: 'var(--text2)' }}>&#8250;</span>
        </div>

        <div className="setting-item" style={{ cursor: 'pointer', position: 'relative' }}>
          <div>
            <div className="label">Import Backup</div>
            <div className="desc">Restore from a JSON backup file</div>
          </div>
          <input type="file" accept=".json" onChange={importData}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          <span style={{ color: 'var(--text2)' }}>&#8250;</span>
        </div>

        <div className="setting-item" onClick={clearAllData} style={{ cursor: 'pointer' }}>
          <div>
            <div className="label" style={{ color: 'var(--red)' }}>Clear All Data</div>
            <div className="desc">Delete everything — cannot be undone</div>
          </div>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
