const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');

const router = express.Router();

function getModel(type) {
  if (type === 'borrower') return Borrower;
  if (type === 'loan') return Loan;
  if (type === 'payment') return Payment;
  return null;
}

function sanitizeBorrowerPayload(data, syncId) {
  return {
    name: typeof data.name === 'string' ? data.name.trim() : data.name,
    notes: data.notes || '',
    syncId,
    deletedAt: data._deleted ? new Date() : null,
  };
}

async function sanitizeLoanPayload(data, syncId) {
  let borrowerId = data.borrowerId;
  if (!borrowerId && data.borrowerSyncId) {
    const borrower = await Borrower.findOne({ syncId: data.borrowerSyncId, deletedAt: null }).select('_id').lean();
    borrowerId = borrower?._id;
  }

  return {
    borrowerId,
    principal: data.principal,
    ratePerMonth: data.ratePerMonth,
    startDate: data.startDate,
    dateGiven: data.dateGiven || null,
    paymentFrequency: [1, 6, 12].includes(data.paymentFrequency) ? data.paymentFrequency : 1,
    oldDue: typeof data.oldDue === 'number' && data.oldDue >= 0 ? data.oldDue : 0,
    status: data.status || 'active',
    notes: data.notes || '',
    rateHistory: Array.isArray(data.rateHistory) ? data.rateHistory : [],
    principalRepayments: Array.isArray(data.principalRepayments) ? data.principalRepayments : [],
    syncId,
    deletedAt: data._deleted ? new Date() : null,
  };
}

async function sanitizePaymentPayload(data, syncId) {
  let loanId = data.loanId;
  if (!loanId && data.loanSyncId) {
    const loan = await Loan.findOne({ syncId: data.loanSyncId, deletedAt: null }).select('_id').lean();
    loanId = loan?._id;
  }

  return {
    loanId,
    amount: data.amount,
    paidDate: data.paidDate ? new Date(data.paidDate) : new Date(),
    mode: data.mode || 'cash',
    notes: data.notes || '',
    photoProofUrl: data.photoProofUrl || '',
    settlements: Array.isArray(data.settlements) ? data.settlements : [],
    syncId,
    deletedAt: data._deleted ? new Date() : null,
  };
}

async function sanitizePayload(type, data, syncId) {
  if (type === 'borrower') return sanitizeBorrowerPayload(data, syncId);
  if (type === 'loan') return sanitizeLoanPayload(data, syncId);
  if (type === 'payment') return sanitizePaymentPayload(data, syncId);
  return null;
}

router.post('/push', async (req, res) => {
  try {
    const { changes } = req.body;
    if (!Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes must be an array' });
    }

    const results = [];

    for (const change of changes) {
      const { type, action, data = {}, syncId } = change;
      const Model = getModel(type);

      if (!Model) {
        results.push({ syncId, status: 'error', error: `Unknown type: ${type}` });
        continue;
      }

      try {
        if (action === 'delete') {
          const doc = await Model.findOneAndUpdate(
            { syncId },
            { deletedAt: new Date() },
            { new: true }
          );
          results.push({ syncId, status: 'ok', serverData: doc || null });
          continue;
        }

        const payload = await sanitizePayload(type, data, syncId);

        if ((type === 'loan' && !payload.borrowerId) || (type === 'payment' && !payload.loanId)) {
          results.push({ syncId, status: 'conflict', error: 'Related record not synced yet' });
          continue;
        }

        if (action === 'create') {
          const existing = await Model.findOne({ syncId });
          if (existing) {
            const updated = await Model.findOneAndUpdate({ syncId }, payload, { new: true });
            results.push({ syncId, status: 'ok', serverData: updated });
          } else {
            const doc = await Model.create(payload);
            results.push({ syncId, status: 'ok', serverData: doc });
          }
        } else if (action === 'update') {
          const doc = await Model.findOneAndUpdate({ syncId }, payload, { new: true });
          if (doc) {
            results.push({ syncId, status: 'ok', serverData: doc });
          } else {
            results.push({ syncId, status: 'conflict', error: 'Document not found' });
          }
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
