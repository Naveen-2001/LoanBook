const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const rateHistorySchema = new mongoose.Schema({
  rate: { type: Number, required: true },
  effectiveFrom: { type: String, required: true }, // "YYYY-MM"
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const principalRepaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  notes: { type: String, default: '' },
}, { _id: true });

const loanSchema = new mongoose.Schema({
  borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Borrower', required: true, index: true },
  principal: { type: Number, required: true },
  ratePerMonth: { type: Number, required: true },
  startDate: { type: String, required: true }, // "YYYY-MM"
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  notes: { type: String, default: '' },
  rateHistory: [rateHistorySchema],
  principalRepayments: [principalRepaymentSchema],
  syncId: { type: String, default: uuidv4 },
}, {
  timestamps: true,
});

loanSchema.index({ borrowerId: 1, status: 1 });
loanSchema.index({ syncId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Loan', loanSchema);
