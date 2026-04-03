const express = require('express');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { settle, recalculateAllSettlements, generateSettlementSummary } = require('../services/settlement');

const router = express.Router();

router.get('/loan/:loanId', async (req, res) => {
  try {
    const payments = await Payment.find({ loanId: req.params.loanId, deletedAt: null })
      .sort({ paidDate: -1 })
      .lean();

    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/loan/:loanId', async (req, res) => {
  try {
    const { amount, paidDate, mode, notes } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const loan = await Loan.findOne({ _id: req.params.loanId, deletedAt: null }).lean();
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const existingPayments = await Payment.find({ loanId: loan._id, deletedAt: null }).lean();
    const { settlements, excess } = settle(loan, existingPayments, amount);

    const payment = await Payment.create({
      loanId: loan._id,
      amount,
      paidDate: paidDate ? new Date(paidDate) : new Date(),
      mode: mode || 'cash',
      notes,
      settlements,
    });

    const summary = generateSettlementSummary(settlements, excess);
    res.status(201).json({ payment, summary, excess });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, deletedAt: null });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const loanId = payment.loanId;
    await Payment.findByIdAndUpdate(req.params.id, { deletedAt: new Date() });

    const loan = await Loan.findOne({ _id: loanId, deletedAt: null }).lean();
    if (!loan) return res.json({ message: 'Payment deleted, loan not found for recalculation', warning: true });

    const remainingPayments = await Payment.find({ loanId, deletedAt: null }).lean();
    if (remainingPayments.length > 0) {
      const recalculated = recalculateAllSettlements(loan, remainingPayments);
      for (const updated of recalculated) {
        await Payment.findByIdAndUpdate(updated._id, { settlements: updated.settlements });
      }
    }

    res.json({ message: 'Payment deleted and settlements recalculated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
