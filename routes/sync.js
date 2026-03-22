const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');
const router = express.Router();

// POST /api/sync/push — Push local changes to server
router.post('/push', async (req, res) => {
  try {
    const { changes } = req.body;
    if (!Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes must be an array' });
    }

    const results = [];

    for (const change of changes) {
      const { type, action, data, syncId } = change;

      try {
        let Model;
        if (type === 'borrower') Model = Borrower;
        else if (type === 'loan') Model = Loan;
        else if (type === 'payment') Model = Payment;
        else {
          results.push({ syncId, status: 'error', error: `Unknown type: ${type}` });
          continue;
        }

        if (action === 'create') {
          // Check if already exists by syncId
          const existing = await Model.findOne({ syncId });
          if (existing) {
            results.push({ syncId, status: 'ok', serverData: existing });
          } else {
            const doc = await Model.create({ ...data, syncId });
            results.push({ syncId, status: 'ok', serverData: doc });
          }
        } else if (action === 'update') {
          const doc = await Model.findOneAndUpdate({ syncId }, data, { new: true });
          if (doc) {
            results.push({ syncId, status: 'ok', serverData: doc });
          } else {
            results.push({ syncId, status: 'conflict', error: 'Document not found' });
          }
        } else if (action === 'delete') {
          await Model.findOneAndDelete({ syncId });
          results.push({ syncId, status: 'ok' });
        } else {
          results.push({ syncId, status: 'error', error: `Unknown action: ${action}` });
        }
      } catch (err) {
        results.push({ syncId, status: 'error', error: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/pull?since=<timestamp> — Pull changes since last sync
router.get('/pull', async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    const [borrowers, loans, payments] = await Promise.all([
      Borrower.find({ updatedAt: { $gte: since } }).lean(),
      Loan.find({ updatedAt: { $gte: since } }).lean(),
      Payment.find({ updatedAt: { $gte: since } }).lean(),
    ]);

    res.json({
      borrowers,
      loans,
      payments,
      serverTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
