const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const borrowerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  notes: { type: String, default: '' },
  syncId: { type: String, default: uuidv4 },
}, {
  timestamps: true,
});

borrowerSchema.index({ name: 1 });
borrowerSchema.index({ syncId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Borrower', borrowerSchema);
