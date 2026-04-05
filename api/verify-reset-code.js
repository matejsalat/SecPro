const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, code, newPassword } = req.body;
  if (!token || !code) return res.status(400).json({ error: 'Token and code are required' });

  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(500).json({ error: 'Server not configured' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  // Verify token signature
  const parts = token.split('.');
  if (parts.length !== 2) return res.status(400).json({ error: 'Invalid token' });

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', RESET_SECRET).update(payloadB64).digest('hex');

  if (signature !== expectedSig) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  // Parse and validate payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
  } catch {
    return res.status(400).json({ error: 'Invalid token' });
  }

  if (Date.now() > payload.exp) {
    return res.status(400).json({ error: 'Kód vypršal. Požiadajte o nový.' });
  }

  // Verify code
  const codeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
  if (codeHash !== payload.codeHash) {
    return res.status(400).json({ error: 'Nesprávny kód.' });
  }

  // If new password provided, update it in Redis
  if (newPassword && KV_URL && KV_TOKEN) {
    try {
      const emailLower = payload.email.toLowerCase();
      const userKey = `user:${emailLower}`;

      // Get existing user data
      const userRes = await fetch(`${KV_URL}/get/${encodeURIComponent(userKey)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      const userData = await userRes.json();

      const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');

      if (userData.result) {
        // Update existing user
        const user = typeof userData.result === 'string' ? JSON.parse(userData.result) : userData.result;
        user.passwordHash = passwordHash;
        const updatedData = JSON.stringify(user);
        await fetch(`${KV_URL}/set/${encodeURIComponent(userKey)}/${encodeURIComponent(updatedData)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` },
        });
      } else {
        // Create new user from reset email
        const newUser = JSON.stringify({
          name: emailLower.split('@')[0],
          email: emailLower,
          passwordHash,
          createdAt: new Date().toISOString(),
        });
        await fetch(`${KV_URL}/set/${encodeURIComponent(userKey)}/${encodeURIComponent(newUser)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` },
        });
      }
    } catch (err) {
      console.error('verify-reset-code: Failed to update password in Redis:', err.message);
      // Don't fail the whole request — code was verified, password update is best-effort
    }
  }

  return res.status(200).json({ verified: true, email: payload.email });
};
