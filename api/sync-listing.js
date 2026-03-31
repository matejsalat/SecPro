/**
 * SecPro → LEONIS sync proxy
 *
 * Keeps SECPRO_INGEST_SECRET off the browser.
 * POST  → forwards property payload to LEONIS ingest (publish)
 * DELETE → forwards { id } to LEONIS ingest (unpublish)
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const leonisUrl = process.env.LEONIS_INGEST_URL;
  const secret = process.env.SECPRO_INGEST_SECRET;

  if (!leonisUrl || !secret) {
    console.error('[sync-listing] Missing LEONIS_INGEST_URL or SECPRO_INGEST_SECRET');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upstream = await fetch(leonisUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-secpro-secret': secret,
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[sync-listing] upstream error:', err.message);
    return res.status(502).json({ error: 'Upstream error' });
  }
};
