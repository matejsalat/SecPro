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
    return res.status(200).json({ success: true }); // Already logged out
  }

  try {
    const sessionKey = `session:${token}`;
    await fetch(`${KV_URL}/del/${encodeURIComponent(sessionKey)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('auth-logout error:', err.message);
    return res.status(200).json({ success: true }); // Logout should always succeed client-side
  }
};
