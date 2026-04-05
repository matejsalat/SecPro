const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'Server nie je nakonfigurovaný (KV)' });
  }

  const { email, password, remember } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email a heslo sú povinné.' });
  }

  const emailLower = email.trim().toLowerCase();
  const userKey = `user:${emailLower}`;

  try {
    // Get user from Redis
    const userRes = await fetch(`${KV_URL}/get/${encodeURIComponent(userKey)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const userData = await userRes.json();

    if (!userData.result) {
      return res.status(401).json({ error: 'Nesprávny e-mail alebo heslo.' });
    }

    const user = typeof userData.result === 'string' ? JSON.parse(userData.result) : userData.result;

    // Verify password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.passwordHash !== passwordHash) {
      return res.status(401).json({ error: 'Nesprávny e-mail alebo heslo.' });
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresIn = remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60; // 30 days or 24 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const sessionData = JSON.stringify({
      email: user.email,
      name: user.name,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    const sessionKey = `session:${token}`;

    // Store session in Redis with TTL
    const setRes = await fetch(
      `${KV_URL}/set/${encodeURIComponent(sessionKey)}/${encodeURIComponent(sessionData)}/ex/${expiresIn}`,
      { headers: { Authorization: `Bearer ${KV_TOKEN}` } }
    );

    if (!setRes.ok) {
      throw new Error('Failed to create session');
    }

    return res.status(200).json({
      success: true,
      token,
      user: { name: user.name, email: user.email },
      expiresAt,
    });
  } catch (err) {
    console.error('auth-login error:', err.message);
    return res.status(500).json({ error: 'Chyba servera pri prihlásení.' });
  }
};
