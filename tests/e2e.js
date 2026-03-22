const http = require('http');

const BASE = 'http://localhost:3001';
let TOKEN = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, headers: { 'Content-Type': 'application/json' },
    };
    if (TOKEN) options.headers['Authorization'] = `Bearer ${TOKEN}`;
    const r = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON: ${data.slice(0, 100)}`)); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  PASS:', msg);
}

async function run() {
  console.log('=== E2E Tests ===\n');

  // 1. Auth
  const auth = await req('POST', '/api/auth/login', { pin: '1234' });
  TOKEN = auth.token;
  assert(TOKEN, 'Login returns token');

  // 2. Create borrower
  const borrower = await req('POST', '/api/borrowers', { name: 'Ramesh Kumar' });
  assert(borrower._id, 'Borrower created: ' + borrower.name);

  // 3. Create loan: 3L @ 2% from Jan 2025
  const loan = await req('POST', `/api/loans/borrower/${borrower._id}`, {
    principal: 300000, ratePerMonth: 2, startDate: '2025-01',
  });
  assert(loan._id, 'Loan created: ' + loan.principal);

  // 4. Pay ₹54,000 — should cover Jan-Sep (9 × ₹6000)
  const pay1 = await req('POST', `/api/payments/loan/${loan._id}`, {
    amount: 54000, paidDate: '2025-09-30', mode: 'upi',
  });
  assert(pay1.payment.settlements.length === 9, `Payment 1: settled ${pay1.payment.settlements.length} months (expect 9)`);
  assert(pay1.payment.settlements.every(s => s.isFull), 'All 9 months fully settled');
  assert(pay1.excess === 0, 'No excess');

  // 5. Pay ₹16,000 — Oct full, Nov full, Dec partial ₹4000
  const pay2 = await req('POST', `/api/payments/loan/${loan._id}`, {
    amount: 16000, paidDate: '2026-03-15', mode: 'cash',
  });
  assert(pay2.payment.settlements.length === 3, `Payment 2: settled ${pay2.payment.settlements.length} months (expect 3)`);
  assert(pay2.payment.settlements[0].forMonth === '2025-10' && pay2.payment.settlements[0].isFull, 'Oct fully settled');
  assert(pay2.payment.settlements[1].forMonth === '2025-11' && pay2.payment.settlements[1].isFull, 'Nov fully settled');
  assert(pay2.payment.settlements[2].forMonth === '2025-12' && !pay2.payment.settlements[2].isFull, 'Dec partial');
  assert(pay2.payment.settlements[2].settledAmount === 4000, 'Dec settled ₹4000');

  // 6. Check loan status
  const status1 = await req('GET', `/api/loans/${loan._id}/status`);
  // 15 months (Jan 2025 – Mar 2026), each ₹6000 = ₹90,000
  assert(status1.totalDue === 90000, `totalDue: ${status1.totalDue} (expect 90000)`);
  assert(status1.totalPaid === 70000, `totalPaid: ${status1.totalPaid} (expect 70000 = 54000+16000)`);
  assert(status1.totalPending === 20000, `totalPending: ${status1.totalPending} (expect 20000)`);
  assert(status1.pendingSince === '2025-12', `pendingSince: ${status1.pendingSince} (expect 2025-12)`);

  // 7. Change rate to 1.5% from Feb 2026
  const rateChange = await req('POST', `/api/loans/${loan._id}/change-rate`, {
    newRate: 1.5, effectiveFrom: '2026-02',
  });
  assert(rateChange.rateHistory.length === 2, 'Rate history has 2 entries (original + new)');

  // 8. Check status with new rate
  const status2 = await req('GET', `/api/loans/${loan._id}/status`);
  const jan26 = status2.months.find(m => m.month === '2026-01');
  const feb26 = status2.months.find(m => m.month === '2026-02');
  const mar26 = status2.months.find(m => m.month === '2026-03');
  assert(jan26.due === 6000, `Jan 2026 due: ${jan26.due} (expect 6000 at 2%)`);
  assert(feb26.due === 4500, `Feb 2026 due: ${feb26.due} (expect 4500 at 1.5%)`);
  assert(mar26.due === 4500, `Mar 2026 due: ${mar26.due} (expect 4500 at 1.5%)`);
  assert(status2.monthlyDue === 4500, `monthlyDue: ${status2.monthlyDue} (expect 4500)`);

  // 9. Repay ₹50k principal (should affect Mar 2026 — same month)
  await req('POST', `/api/loans/${loan._id}/repay-principal`, {
    amount: 50000, date: '2026-03-01',
  });

  const status3 = await req('GET', `/api/loans/${loan._id}/status`);
  assert(status3.outstandingPrincipal === 250000, `outstanding: ${status3.outstandingPrincipal} (expect 250000)`);
  const mar26v2 = status3.months.find(m => m.month === '2026-03');
  assert(mar26v2.due === 3750, `Mar 2026 due after repayment: ${mar26v2.due} (expect 3750 = 250000*1.5%)`);
  assert(status3.monthlyDue === 3750, `monthlyDue: ${status3.monthlyDue} (expect 3750)`);

  // 10. Delete payment and verify recalculation
  const payments = await req('GET', `/api/payments/loan/${loan._id}`);
  const firstPaymentId = payments.find(p => p.amount === 54000)?._id;
  assert(firstPaymentId, 'Found first payment');
  await req('DELETE', `/api/payments/${firstPaymentId}`);

  const status4 = await req('GET', `/api/loans/${loan._id}/status`);
  assert(status4.totalPaid === 16000, `After delete: totalPaid ${status4.totalPaid} (expect 16000)`);
  assert(status4.pendingSince === '2025-03', `After delete: pendingSince ${status4.pendingSince} (expect 2025-03 since 16k covers Jan+Feb+partial Mar)`);

  // 11. Validation tests
  const badBorrower = await req('POST', '/api/borrowers', { name: '' });
  assert(badBorrower.error, 'Empty name rejected: ' + badBorrower.error);

  const badLoan = await req('POST', `/api/loans/borrower/${borrower._id}`, { principal: -100, ratePerMonth: 2, startDate: '2025-01' });
  assert(badLoan.error, 'Negative principal rejected: ' + badLoan.error);

  const badRate = await req('POST', `/api/loans/${loan._id}/change-rate`, { newRate: 0, effectiveFrom: '2026-04' });
  assert(badRate.error, 'Zero rate rejected: ' + badRate.error);

  const badUpdate = await req('PUT', `/api/borrowers/${borrower._id}`, { name: '' });
  assert(badUpdate.error, 'Empty name update rejected: ' + badUpdate.error);

  // 12. Dashboard
  const dash = await req('GET', '/api/dashboard');
  assert(dash.totalLent === 300000, `Dashboard totalLent: ${dash.totalLent}`);
  assert(dash.borrowers.length === 1, `Dashboard borrowers: ${dash.borrowers.length}`);

  console.log('\n=== ALL TESTS PASSED ===');

  // Cleanup
  const mongoose = require('mongoose');
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.db.dropDatabase();
  console.log('DB cleaned');
  process.exit(0);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
