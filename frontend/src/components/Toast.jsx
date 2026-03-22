import { useState, useEffect } from 'react';

let listeners = [];

export function toast(message, duration = 2500) {
  listeners.forEach(fn => fn(message, duration));
}

export default function ToastContainer() {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (message, duration) => {
      setMsg(message);
      setVisible(true);
      setTimeout(() => setVisible(false), duration);
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, []);

  if (!visible) return null;
  return <div className="toast">{msg}</div>;
}
