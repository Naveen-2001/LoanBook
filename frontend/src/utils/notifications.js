import db from '../db';

const FREQ_LABELS = { 1: 'Monthly', 6: 'Half-yearly', 12: 'Yearly' };

function getNextCollectionMonth(startDate, frequency) {
  const [startY, startM] = startDate.split('-').map(Number);
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;
  let m = startM;
  let y = startY;
  while (y < nowY || (y === nowY && m < nowM)) {
    m += frequency;
    while (m > 12) { m -= 12; y++; }
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export async function checkDueNotifications() {
  try {
    const loans = await db.loans.toArray();
    const borrowers = await db.borrowers.toArray();
    const borrowerMap = {};
    borrowers.forEach(b => { borrowerMap[String(b.id)] = b.name; });

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dueLoans = [];

    for (const loan of loans) {
      if (loan.status !== 'active') continue;
      const freq = loan.paymentFrequency || 1;
      if (freq === 1) continue; // monthly loans don't need special notification

      const nextDue = getNextCollectionMonth(loan.startDate, freq);
      if (nextDue === currentMonth) {
        const borrowerName = borrowerMap[String(loan.borrowerId)] || 'Unknown';
        dueLoans.push({ loan, borrowerName, freq });
      }
    }

    if (dueLoans.length === 0) return;

    // Check if we already notified today
    const lastNotified = localStorage.getItem('loanbook_last_notification');
    const today = now.toISOString().split('T')[0];
    if (lastNotified === today) return;
    localStorage.setItem('loanbook_last_notification', today);

    // Build notification message
    const lines = dueLoans.map(d =>
      `${d.borrowerName} — ${FREQ_LABELS[d.freq] || d.freq + ' monthly'} payment due this month`
    );
    const body = lines.join('\n');

    // Try browser notification
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('LoanBook — Payment Due', { body, icon: '/icon-192.png' });
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('LoanBook — Payment Due', { body, icon: '/icon-192.png' });
        }
      }
    }

    return dueLoans;
  } catch (err) {
    console.error('Notification check error:', err);
    return [];
  }
}
