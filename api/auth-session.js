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

  const { token } = req.body;
  if (!token) {
    return res.status(401).json({ error: 'Token chýba.' });
  }

  const sessionKey = `session:${token}`;

  try {
    const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(sessionKey)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const sessionData = await sessionRes.json();

    if (!sessionData.result) {
      return res.status(401).json({ error: 'Sedenie vypršalo alebo neexistuje.' });
    }

    const session = typeof sessionData.result === 'string' ? JSON.parse(sessionData.result) : sessionData.result;

    // Check expiration (Redis TTL should handle this, but double-check)
    if (new Date(session.expiresAt) < new Date()) {
      // Clean up expired session
      await fetch(`${KV_URL}/del/${encodeURIComponent(sessionKey)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      return res.status(401).json({ error: 'Sedenie vypršalo.' });
    }

    return res.status(200).json({
      success: true,
      user: { name: session.name, email: session.email },
    });
  } catch (err) {
    console.error('auth-session error:', err.message);
    return res.status(500).json({ error: 'Chyba servera pri overení sedenia.' });
  }
};
