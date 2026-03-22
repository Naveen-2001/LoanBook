const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { pin } = req.body;

  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }

  if (pin !== process.env.AUTH_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const token = jwt.sign({ role: 'owner' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

module.exports = router;
