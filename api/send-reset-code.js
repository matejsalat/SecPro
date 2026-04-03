const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESEND_API_KEY || !RESET_SECRET) {
    console.error('Missing env vars:', { hasResendKey: !!RESEND_API_KEY, hasResetSecret: !!RESET_SECRET });
    return res.status(500).json({ error: 'Server not configured', detail: 'Missing: ' + (!RESEND_API_KEY ? 'RESEND_API_KEY ' : '') + (!RESET_SECRET ? 'RESET_SECRET' : '') });
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Create signed token (stateless verification)
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const payload = JSON.stringify({ email: email.toLowerCase(), codeHash, exp });
  const payloadB64 = Buffer.from(payload).toString('base64');
  const signature = crypto.createHmac('sha256', RESET_SECRET).update(payloadB64).digest('hex');
  const token = payloadB64 + '.' + signature;

  // Send email via Resend
  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SecPro <onboarding@resend.dev>',
        to: [email],
        subject: 'SecPro — Kód na obnovenie hesla',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
            <h2 style="color:#0B2A3C;margin-bottom:8px">SecPro</h2>
            <p style="color:#666;margin-bottom:24px">Váš kód na obnovenie hesla:</p>
            <div style="background:#f0f2f5;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
              <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0B2A3C">${code}</span>
            </div>
            <p style="color:#999;font-size:13px">Kód platí 10 minút. Ak ste o reset nepožiadali, ignorujte tento email.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      console.error('Resend API error:', JSON.stringify(err));
      return res.status(500).json({ error: 'Failed to send email', detail: err.message || JSON.stringify(err) });
    }

    return res.status(200).json({ token });
  } catch (err) {
    console.error('Send email exception:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to send email', detail: err.message });
  }
};
