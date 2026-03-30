const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, code } = req.body;
  if (!token || !code) return res.status(400).json({ error: 'Token and code are required' });

  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(500).json({ error: 'Server not configured' });

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

  return res.status(200).json({ verified: true, email: payload.email });
};
