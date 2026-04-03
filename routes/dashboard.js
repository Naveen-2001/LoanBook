const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { getLoanStatus } = require('../services/settlement');
const { getCurrentMonth } = require('../utils/monthHelpers');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const borrowers = await Borrower.find({ deletedAt: null }).sort({ name: 1 }).lean();
    const loans = await Loan.find({ status: 'active', deletedAt: null }).lean();
    const payments = await Payment.find({ deletedAt: null }).lean();

    const loansByBorrower = {};
    const paymentsByLoan = {};

    for (const loan of loans) {
      const borrowerId = loan.borrowerId.toString();
      if (!loansByBorrower[borrowerId]) loansByBorrower[borrowerId] = [];
      loansByBorrower[borrowerId].push(loan);
    }

    for (const payment of payments) {
      const loanId = payment.loanId.toString();
      if (!paymentsByLoan[loanId]) paymentsByLoan[loanId] = [];
      paymentsByLoan[loanId].push(payment);
    }

    let totalLent = 0;
    let totalMonthlyDue = 0;
    let totalPending = 0;
    let totalCollectedThisMonth = 0;
    const currentMonth = getCurrentMonth();

    const borrowerSummaries = borrowers.map(borrower => {
      const borrowerId = borrower._id.toString();
      const borrowerLoans = loansByBorrower[borrowerId] || [];

      let borrowerPrincipal = 0;
      let borrowerPending = 0;
      let borrowerPendingMonths = 0;
      let borrowerPendingSince = null;
      let borrowerLastPaymentDate = null;

      for (const loan of borrowerLoans) {
        const loanId = loan._id.toString();
        const loanPayments = paymentsByLoan[loanId] || [];
        const status = getLoanStatus(loan, loanPayments);

        borrowerPrincipal += loan.principal;
        borrowerPending += status.totalPending;
        borrowerPendingMonths += status.pendingMonths;

        if (status.pendingSince && (!borrowerPendingSince || status.pendingSince < borrowerPendingSince)) {
          borrowerPendingSince = status.pendingSince;
        }

        totalMonthlyDue += status.monthlyDue;

        for (const payment of loanPayments) {
          const paymentDate = new Date(payment.paidDate);
          if (!borrowerLastPaymentDate || paymentDate > borrowerLastPaymentDate) {
            borrowerLastPaymentDate = paymentDate;
          }

          const paymentMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
          if (paymentMonth === currentMonth) {
            totalCollectedThisMonth += payment.amount;
          }
        }
      }

      totalLent += borrowerPrincipal;
      totalPending += borrowerPending;

      let status = 'paid';
      if (borrowerPendingMonths > 0 && borrowerPending > 0) {
        status = borrowerPendingMonths >= 2 ? 'overdue' : 'partial';
      }

      return {
        _id: borrower._id,
        name: borrower.name,
        notes: borrower.notes,
        loanCount: borrowerLoans.length,
        totalPrincipal: borrowerPrincipal,
        totalPending: borrowerPending,
        pendingMonths: borrowerPendingMonths,
        pendingSince: borrowerPendingSince,
        lastPaymentDate: borrowerLastPaymentDate,
        status,
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
