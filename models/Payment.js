const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const settlementSchema = new mongoose.Schema({
  forMonth: { type: String, required: true }, // "YYYY-MM"
  dueAmount: { type: Number, required: true },
  settledAmount: { type: Number, required: true },
  isFull: { type: Boolean, required: true },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
  amount: { type: Number, required: true },
  paidDate: { type: Date, required: true },
  mode: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'other'], default: 'cash' },
  notes: { type: String, default: '' },
  photoProofUrl: { type: String, default: '' },
  settlements: [settlementSchema],
  syncId: { type: String, default: uuidv4 },
}, {
  timestamps: true,
});

paymentSchema.index({ loanId: 1, paidDate: 1 });
paymentSchema.index({ syncId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
