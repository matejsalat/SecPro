// Supabase client (service-role — backend / worker use only).
// Never import this in frontend code.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

// Convenience: get portal id by slug (cached)
const portalCache = new Map();
async function getPortalId(slug) {
  if (portalCache.has(slug)) return portalCache.get(slug);
  const { data, error } = await supabase
    .from('portals')
    .select('id')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`Portal "${slug}" not found: ${error.message}`);
  portalCache.set(slug, data.id);
  return data.id;
}

module.exports = { supabase, getPortalId };
