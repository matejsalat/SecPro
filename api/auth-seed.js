// One-time seed endpoint to migrate existing users to Redis
// DELETE THIS FILE after migration is complete
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const SEED_SECRET = process.env.RESET_SECRET; // Reuse existing secret for auth

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured' });
  }

  const { secret, users } = req.body;
  if (secret !== SEED_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!users || !Array.isArray(users)) {
    return res.status(400).json({ error: 'users array required' });
  }

  const results = [];

  for (const u of users) {
    const emailLower = u.email.trim().toLowerCase();
    const userKey = `user:${emailLower}`;

    // Hash the password (raw password expected)
    const passwordHash = crypto.createHash('sha256').update(u.password).digest('hex');

    const userData = JSON.stringify({
      name: u.name || emailLower.split('@')[0],
      email: emailLower,
      passwordHash,
      createdAt: u.createdAt || new Date().toISOString(),
    });

    try {
      const setRes = await fetch(`${KV_URL}/set/${encodeURIComponent(userKey)}/${encodeURIComponent(userData)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      const result = await setRes.json();
      results.push({ email: emailLower, status: 'ok', result: result.result });
    } catch (err) {
      results.push({ email: emailLower, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ results });
};
