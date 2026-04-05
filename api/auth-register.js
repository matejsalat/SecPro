const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'Server nie je nakonfigurovaný (KV)' });
  }

  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Meno, email a heslo sú povinné.' });
  }

  const emailLower = email.trim().toLowerCase();
  const userKey = `user:${emailLower}`;

  try {
    // Check if user already exists
    const existsRes = await fetch(`${KV_URL}/get/${userKey}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const existsData = await existsRes.json();

    if (existsData.result) {
      return res.status(409).json({ error: 'Účet s týmto e-mailom už existuje.' });
    }

    // Hash password with SHA-256
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    // Store user in Redis
    const userData = JSON.stringify({
      name: name.trim(),
      email: emailLower,
      passwordHash,
      createdAt: new Date().toISOString(),
    });

    const setRes = await fetch(`${KV_URL}/set/${encodeURIComponent(userKey)}/${encodeURIComponent(userData)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });

    if (!setRes.ok) {
      const err = await setRes.json().catch(() => ({}));
      throw new Error(err.error || 'Redis SET failed');
    }

    return res.status(201).json({ success: true, message: 'Účet vytvorený.' });
  } catch (err) {
    console.error('auth-register error:', err.message);
    return res.status(500).json({ error: 'Chyba servera pri registrácii.' });
  }
};
