const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { getLoanStatus } = require('../services/settlement');

const router = express.Router();

router.get('/borrower/:borrowerId', async (req, res) => {
  try {
    const loans = await Loan.find({
      borrowerId: req.params.borrowerId,
      deletedAt: null,
    }).sort({ createdAt: -1 }).lean();

    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/borrower/:borrowerId', async (req, res) => {
  try {
    const { principal, ratePerMonth, startDate, dateGiven, notes, paymentFrequency, oldDue } = req.body;

    const borrowerExists = await Borrower.exists({
      _id: req.params.borrowerId,
      deletedAt: null,
    });
    if (!borrowerExists) {
      return res.status(404).json({ error: 'Borrower not found' });
    }

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
      dateGiven: dateGiven || null,
      paymentFrequency: [1, 6, 12].includes(paymentFrequency) ? paymentFrequency : 1,
      oldDue: typeof oldDue === 'number' && oldDue >= 0 ? oldDue : 0,
      notes,
    });

    res.status(201).json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { principal, ratePerMonth, startDate, dateGiven, notes, status, paymentFrequency, oldDue } = req.body;
    const update = {};

    if (principal !== undefined) {
      if (typeof principal !== 'number' || principal <= 0) {
        return res.status(400).json({ error: 'Valid principal amount is required' });
      }
      update.principal = principal;
    }

    if (ratePerMonth !== undefined) {
      if (typeof ratePerMonth !== 'number' || ratePerMonth <= 0) {
        return res.status(400).json({ error: 'Valid rate per month is required' });
      }
      update.ratePerMonth = ratePerMonth;
    }

    if (startDate !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(startDate)) {
        return res.status(400).json({ error: 'Start date must be in YYYY-MM format' });
      }
      update.startDate = startDate;
    }

    if (dateGiven !== undefined) update.dateGiven = dateGiven || null;
    if (notes !== undefined) update.notes = notes;
    if (status !== undefined) update.status = status;

    if (paymentFrequency !== undefined) {
      if (![1, 6, 12].includes(paymentFrequency)) {
        return res.status(400).json({ error: 'paymentFrequency must be 1, 6, or 12' });
      }
      update.paymentFrequency = paymentFrequency;
    }

    if (oldDue !== undefined) {
      if (typeof oldDue !== 'number' || oldDue < 0) {
        return res.status(400).json({ error: 'oldDue must be a non-negative number' });
      }
      update.oldDue = oldDue;
    }

    const loan = await Loan.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      update,
      { new: true }
    );

    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/change-rate', async (req, res) => {
  try {
    const { newRate, effectiveFrom } = req.body;

    if (!newRate || typeof newRate !== 'number' || newRate <= 0) {
      return res.status(400).json({ error: 'Valid new rate is required' });
    }
    if (!effectiveFrom || !/^\d{4}-\d{2}$/.test(effectiveFrom)) {
      return res.status(400).json({ error: 'effectiveFrom must be in YYYY-MM format' });
    }

    const loan = await Loan.findOne({ _id: req.params.id, deletedAt: null });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

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

    await loan.save();
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/repay-principal', async (req, res) => {
  try {
    const { amount, date, notes } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const loan = await Loan.findOne({ _id: req.params.id, deletedAt: null });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const totalRepaid = loan.principalRepayments.reduce((sum, repayment) => sum + repayment.amount, 0);
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

router.post('/:id/close', async (req, res) => {
  try {
    const loan = await Loan.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { status: 'closed' },
      { new: true }
    );

    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const loan = await Loan.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const payments = await Payment.find({ loanId: loan._id, deletedAt: null }).lean();
    const status = getLoanStatus(loan, payments);

    res.json({ loan, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
