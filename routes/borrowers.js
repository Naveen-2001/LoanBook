const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const Payment = require('../models/Payment');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const borrowers = await Borrower.find({ deletedAt: null }).sort({ name: 1 }).lean();
    res.json(borrowers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const borrower = await Borrower.create({ name: name.trim(), notes });
    res.status(201).json(borrower);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, notes } = req.body;
    const update = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      update.name = name.trim();
    }

    if (notes !== undefined) update.notes = notes;

    const borrower = await Borrower.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      update,
      { new: true }
    );

    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });
    res.json(borrower);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const activeLoans = await Loan.countDocuments({
      borrowerId: req.params.id,
      status: 'active',
      deletedAt: null,
    });

    if (activeLoans > 0) {
      return res.status(400).json({ error: 'Cannot delete borrower with active loans' });
    }

    const borrower = await Borrower.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );

    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

    const loans = await Loan.find({ borrowerId: req.params.id, deletedAt: null }).select('_id').lean();
    const loanIds = loans.map(loan => loan._id);

    await Loan.updateMany(
      { borrowerId: req.params.id, deletedAt: null },
      { deletedAt: new Date() }
    );

    if (loanIds.length > 0) {
      await Payment.updateMany(
        { loanId: { $in: loanIds }, deletedAt: null },
        { deletedAt: new Date() }
      );
    }

    res.json({ message: 'Borrower deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
