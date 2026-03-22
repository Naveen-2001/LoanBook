const express = require('express');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { getLoanStatus } = require('../services/settlement');
const router = express.Router();

// GET /api/borrowers/:borrowerId/loans — List all loans for a borrower
router.get('/borrower/:borrowerId', async (req, res) => {
  try {
    const loans = await Loan.find({ borrowerId: req.params.borrowerId }).sort({ createdAt: -1 }).lean();
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/borrowers/:borrowerId/loans — Create loan
router.post('/borrower/:borrowerId', async (req, res) => {
  try {
    const { principal, ratePerMonth, startDate, notes } = req.body;

    if (!principal || typeof principal !== 'number' || principal <= 0) {
      return res.status(400).json({ error: 'Valid principal amount is required' });
    }
    if (!ratePerMonth || typeof ratePerMonth !== 'number' || ratePerMonth <= 0) {
      return res.status(400).json({ error: 'Valid rate per month is required' });
    }
    if (!startDate || !/^\d{4}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ error: 'Start date must be in YYYY-MM format' });
    }

    const loan = await Loan.create({
      borrowerId: req.params.borrowerId,
      principal,
      ratePerMonth,
      startDate,
      notes,
    });

    res.status(201).json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/loans/:id — Update loan
router.put('/:id', async (req, res) => {
  try {
    const { notes, status } = req.body;
    const update = {};
    if (notes !== undefined) update.notes = notes;
    if (status !== undefined) update.status = status;

    const loan = await Loan.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loans/:id/change-rate — Change interest rate
router.post('/:id/change-rate', async (req, res) => {
  try {
    const { newRate, effectiveFrom } = req.body;

    if (!newRate || typeof newRate !== 'number' || newRate <= 0) {
      return res.status(400).json({ error: 'Valid new rate is required' });
    }
    if (!effectiveFrom || !/^\d{4}-\d{2}$/.test(effectiveFrom)) {
      return res.status(400).json({ error: 'effectiveFrom must be in YYYY-MM format' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // If this is the first rate change, save the original rate in history too
    if (loan.rateHistory.length === 0) {
      loan.rateHistory.push({
        rate: loan.ratePerMonth,
        effectiveFrom: loan.startDate,
        changedAt: loan.createdAt || new Date(),
      });
    }

    loan.rateHistory.push({
      rate: newRate,
      effectiveFrom,
      changedAt: new Date(),
    });

    // Do NOT update ratePerMonth — it's the original base rate
    // rateHistory is the source of truth for rate lookups
    await loan.save();

    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loans/:id/repay-principal — Record principal repayment
router.post('/:id/repay-principal', async (req, res) => {
  try {
    const { amount, date, notes } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // Check total repayments don't exceed principal
    const totalRepaid = loan.principalRepayments.reduce((s, r) => s + r.amount, 0);
    if (totalRepaid + amount > loan.principal) {
      return res.status(400).json({ error: 'Total repayments would exceed original principal' });
    }

    loan.principalRepayments.push({
      amount,
      date: date ? new Date(date) : new Date(),
      notes,
    });

    await loan.save();
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loans/:id/close — Close loan
router.post('/:id/close', async (req, res) => {
  try {
    const loan = await Loan.findByIdAndUpdate(req.params.id, { status: 'closed' }, { new: true });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loans/:id/status — Full loan status with month-by-month breakdown
router.get('/:id/status', async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).lean();
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const payments = await Payment.find({ loanId: loan._id }).lean();
    const status = getLoanStatus(loan, payments);

    res.json({ loan, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
