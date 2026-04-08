/**
 * SecPro → LEONIS sync proxy
 *
 * Keeps SECPRO_INGEST_SECRET off the browser.
 * POST  → forwards property payload to LEONIS ingest (publish)
 * DELETE → forwards { id } to LEONIS ingest (unpublish)
 */

const { handleCors } = require('../lib/kv');

module.exports = async function handler(req, res) {
  if (handleCors(req, res, 'POST, DELETE, OPTIONS')) return;

  const leonisUrl = process.env.LEONIS_INGEST_URL;
  const secret = process.env.SECPRO_INGEST_SECRET;

  if (!leonisUrl || !secret) {
    console.error('[sync-listing] Missing LEONIS_INGEST_URL or SECPRO_INGEST_SECRET');
    return res.status(500).json({ error: 'Server misconfiguration' });
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
