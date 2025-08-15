// Simple test version to verify syntax
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook/person-stage-updated', async (req, res) => {
  try {
    console.log('Webhook received:', req.body);
    return res.json({ success: true, message: 'Test successful' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Test failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;