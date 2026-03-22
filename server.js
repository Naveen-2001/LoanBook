require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const auth = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Public routes
app.use('/api/auth', require('./routes/auth'));

// Protected routes
app.use('/api/borrowers', auth, require('./routes/borrowers'));
app.use('/api/loans', auth, require('./routes/loans'));
app.use('/api/payments', auth, require('./routes/payments'));
app.use('/api/dashboard', auth, require('./routes/dashboard'));
app.use('/api/sync', auth, require('./routes/sync'));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`LoanBook API running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
