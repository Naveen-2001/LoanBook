const express = require('express');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const { settle, recalculateAllSettlements, generateSettlementSummary } = require('../services/settlement');
const router = express.Router();

// GET /api/loans/:loanId/payments — List all payments for a loan
router.get('/loan/:loanId', async (req, res) => {
  try {
    const payments = await Payment.find({ loanId: req.params.loanId })
      .sort({ paidDate: -1 })
      .lean();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loans/:loanId/payments — Record a new payment (THE most important endpoint)
router.post('/loan/:loanId', async (req, res) => {
  try {
    const { amount, paidDate, mode, notes } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const loan = await Loan.findById(req.params.loanId).lean();
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // Get all existing payments for FIFO settlement
    const existingPayments = await Payment.find({ loanId: loan._id }).lean();

    // Run settlement algorithm
    const { settlements, excess } = settle(loan, existingPayments, amount);

    // Create the payment
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

// DELETE /api/payments/:id — Delete a payment and recalculate remaining
router.delete('/:id', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const loanId = payment.loanId;
    await Payment.findByIdAndDelete(req.params.id);

    // Recalculate all remaining payments' settlements
    const loan = await Loan.findById(loanId).lean();
    if (!loan) return res.json({ message: 'Payment deleted, loan not found for recalculation', warning: true });

    const remainingPayments = await Payment.find({ loanId }).lean();

    if (remainingPayments.length > 0) {
      const recalculated = recalculateAllSettlements(loan, remainingPayments);

      // Update each payment's settlements in DB
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
