// Smoke test: verify Supabase connection + schema is alive.
// Run: npm run db:test

const { supabase, getPortalId } = require('./supabase');

(async () => {
  console.log('🔌 Testing Supabase connection...\n');

  // 1. Count portals
  const { data: portals, error: pErr } = await supabase
    .from('portals')
    .select('slug, name, is_active, scrape_interval_minutes');
  if (pErr) {
    console.error('❌ Could not read portals:', pErr.message);
    process.exit(1);
  }
  console.log(`✅ Portals (${portals.length}):`);
  portals.forEach(p =>
    console.log(`   ${p.is_active ? '🟢' : '⚪'} ${p.slug.padEnd(15)} ${p.name.padEnd(28)} every ${p.scrape_interval_minutes}m`)
  );

  // 2. Read one portal id (test cache)
  const bzId = await getPortalId('bezrealitky');
  console.log(`\n✅ Portal lookup OK — bezrealitky id: ${bzId.substring(0, 13)}...`);

  // 3. Read config
  const { data: config } = await supabase.from('config').select('key, value');
  console.log(`\n✅ Config entries (${config.length}):`);
  config.slice(0, 3).forEach(c => console.log(`   ${c.key}: ${JSON.stringify(c.value).substring(0, 50)}`));

  // 4. Check listings is empty (fresh start)
  const { count } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true });
  console.log(`\n✅ Listings table reachable (${count} rows currently)`);

  console.log('\n🎉 Connection healthy. Ready to scrape.');
  process.exit(0);
})().catch(e => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
