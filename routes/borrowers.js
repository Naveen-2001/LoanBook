const express = require('express');
const Borrower = require('../models/Borrower');
const Loan = require('../models/Loan');
const router = express.Router();

// GET /api/borrowers — List all borrowers
router.get('/', async (req, res) => {
  try {
    const borrowers = await Borrower.find().sort({ name: 1 }).lean();
    res.json(borrowers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/borrowers — Create borrower
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

// PUT /api/borrowers/:id — Update borrower
router.put('/:id', async (req, res) => {
  try {
    const { name, notes } = req.body;
    const update = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      update.name = name.trim();
    }
    if (notes !== undefined) update.notes = notes;

    const borrower = await Borrower.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });
    res.json(borrower);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/borrowers/:id — Delete borrower (only if no active loans)
router.delete('/:id', async (req, res) => {
  try {
    const activeLoans = await Loan.countDocuments({ borrowerId: req.params.id, status: 'active' });
    if (activeLoans > 0) {
      return res.status(400).json({ error: 'Cannot delete borrower with active loans' });
    }

    const borrower = await Borrower.findByIdAndDelete(req.params.id);
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });
    res.json({ message: 'Borrower deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
