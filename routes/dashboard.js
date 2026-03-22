const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { getLoanStatus } = require('../services/settlement');
const { getCurrentMonth } = require('../utils/monthHelpers');
const router = express.Router();

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    const borrowers = await Borrower.find().sort({ name: 1 }).lean();
    const loans = await Loan.find({ status: 'active' }).lean();
    const payments = await Payment.find().lean();

    // Build lookup maps
    const loansByBorrower = {};
    const paymentsByLoan = {};

    for (const loan of loans) {
      const bid = loan.borrowerId.toString();
      if (!loansByBorrower[bid]) loansByBorrower[bid] = [];
      loansByBorrower[bid].push(loan);
    }

    for (const payment of payments) {
      const lid = payment.loanId.toString();
      if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
      paymentsByLoan[lid].push(payment);
    }

    let totalLent = 0;
    let totalMonthlyDue = 0;
    let totalPending = 0;
    let totalCollectedThisMonth = 0;
    const currentMonth = getCurrentMonth();

    const borrowerSummaries = borrowers.map(borrower => {
      const bid = borrower._id.toString();
      const bLoans = loansByBorrower[bid] || [];

      let bTotalPrincipal = 0;
      let bTotalPending = 0;
      let bPendingMonths = 0;
      let bPendingSince = null;
      let bLastPaymentDate = null;

      for (const loan of bLoans) {
        const lid = loan._id.toString();
        const lPayments = paymentsByLoan[lid] || [];
        const status = getLoanStatus(loan, lPayments);

        bTotalPrincipal += loan.principal;
        bTotalPending += status.totalPending;
        bPendingMonths += status.pendingMonths;

        if (status.pendingSince && (!bPendingSince || status.pendingSince < bPendingSince)) {
          bPendingSince = status.pendingSince;
        }

        totalMonthlyDue += status.monthlyDue;

        // Find last payment date
        for (const p of lPayments) {
          const pDate = new Date(p.paidDate);
          if (!bLastPaymentDate || pDate > bLastPaymentDate) {
            bLastPaymentDate = pDate;
          }

          // Check if payment was this month
          const pMonth = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
          if (pMonth === currentMonth) {
            totalCollectedThisMonth += p.amount;
          }
        }
      }

      totalLent += bTotalPrincipal;
      totalPending += bTotalPending;

      let bStatus = 'paid';
      if (bPendingMonths > 0 && bTotalPending > 0) {
        bStatus = bPendingMonths >= 2 ? 'overdue' : 'partial';
      }

      return {
        _id: borrower._id,
        name: borrower.name,
        notes: borrower.notes,
        loanCount: bLoans.length,
        totalPrincipal: bTotalPrincipal,
        totalPending: bTotalPending,
        pendingMonths: bPendingMonths,
        pendingSince: bPendingSince,
        lastPaymentDate: bLastPaymentDate,
        status: bStatus,
      };
    });

    res.json({
      totalLent,
      totalMonthlyDue,
      totalCollectedThisMonth,
      totalPending,
      borrowers: borrowerSummaries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
