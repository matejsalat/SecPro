const { kvGet, kvSet, handleCors, getKV, validateToken } = require('../../lib/kv');

module.exports = async (req, res) => {
  if (handleCors(req, res, 'GET, OPTIONS')) return;

  const { KV_URL, KV_TOKEN, ok } = getKV();
  if (!ok) return res.status(500).json({ error: 'Server nie je nakonfigurovaný' });

  // Authenticate agent
  const authHeader = req.headers.authorization || '';
  const sessionToken = authHeader.replace('Bearer ', '');
  const session = await validateToken(KV_URL, KV_TOKEN, sessionToken);
  if (!session) return res.status(401).json({ error: 'Neautorizovaný prístup' });

  const indexKey = `sign-index:${session.userId}`;
  const index = (await kvGet(KV_URL, KV_TOKEN, indexKey)) || [];

  // Optionally fetch full record details for signed items
  const { detail } = req.query;

  if (detail) {
    // Fetch single record with full details (including signature image)
    const record = await kvGet(KV_URL, KV_TOKEN, `sign:${detail}`);
    if (!record || record.agentId !== session.userId) {
      return res.status(404).json({ error: 'Záznam nenájdený' });
    }
    return res.status(200).json({ ok: true, record });
  }

  // Mark expired entries
  const now = new Date();
  let changed = false;
  for (const entry of index) {
    if (entry.status === 'pending' && new Date(entry.expiresAt) < now) {
      entry.status = 'expired';
      changed = true;
    }
  }
  if (changed) await kvSet(KV_URL, KV_TOKEN, indexKey, index);

  return res.status(200).json({ ok: true, items: index });
};
