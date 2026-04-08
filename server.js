require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load Vercel-style API routes for local development
const leads = require('./api/leads');
const leadDetail = require('./api/lead-detail');
const aiGenerate = require('./api/ai-generate');
const auth = require('./api/auth');
const data = require('./api/data');
const orsr = require('./api/orsr');
const syncListing = require('./api/sync-listing');
const amlCheck = require('./api/aml-check');

app.all('/api/leads', leads);
app.all('/api/lead-detail', leadDetail);
app.all('/api/ai-generate', aiGenerate);
app.all('/api/auth', auth);
app.all('/api/data', data);
app.all('/api/orsr', orsr);
app.all('/api/sync-listing', syncListing);
app.all('/api/aml-check', amlCheck);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FINIO server running at http://localhost:${PORT}`);
});
