// Standalone runner: scrape bezrealitky.sk and ingest into Supabase.
//
// Run: npm run scrape:bezrealitky -- --location Bratislava --type byt --pages 3
//
// Behavior:
//   1. Start scrape_runs row
//   2. For each page: fetch + parse + upsert into listing_sources
//   3. Insert raw snapshot into listings_raw_history
//   4. Track new vs updated counts
//   5. Close scrape_runs row

const { supabase, getPortalId } = require('../lib/supabase');
const { scrapePage } = require('../scrapers/bezrealitky');
const { sleep } = require('../lib/http');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const location = args.location || 'Bratislava';
  const type = args.type || 'byt';
  const operation = args.operation || 'predaj';
  const pages = parseInt(args.pages || '3');
  const priceMin = args.priceMin ? parseInt(args.priceMin) : null;
  const priceMax = args.priceMax ? parseInt(args.priceMax) : null;

  console.log(`🔎 Bezrealitky scrape: location=${location} type=${type} op=${operation} pages=1..${pages}`);

  const portalId = await getPortalId('bezrealitky');

  // Start scrape_runs
  const { data: runRow, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({ portal_id: portalId, status: 'running' })
    .select()
    .single();
  if (runErr) {
    console.error('Failed to start scrape_runs:', runErr.message);
    process.exit(1);
  }
  const runId = runRow.id;

  const stats = { pages_fetched: 0, listings_seen: 0, new_sources: 0, updated_sources: 0, errors: 0 };
  const errors = [];

  try {
    for (let page = 1; page <= pages; page++) {
      console.log(`\n📄 Page ${page}/${pages}...`);
      let result;
      try {
        result = await scrapePage({ location, type, operation, priceMin, priceMax, page });
      } catch (e) {
        console.error(`  ✗ scrape error: ${e.message}`);
        stats.errors++;
        errors.push({ page, error: e.message });
        continue;
      }
      stats.pages_fetched++;
      stats.listings_seen += result.listings.length;
      console.log(`  found ${result.listings.length} listings (totalCount=${result.totalCount})`);

      if (result.listings.length === 0) break; // empty page → stop

      // Upsert each listing into listing_sources (no canonical listing_id yet)
      for (const item of result.listings) {
        try {
          // We need a listings row to satisfy NOT NULL FK on listing_sources.listing_id.
          // Strategy: pre-create a stub canonical listing per source. Dedup runs later
          // and re-points multiple listing_sources to the same canonical.
          const { data: existing } = await supabase
            .from('listing_sources')
            .select('id, listing_id')
            .eq('portal_id', portalId)
            .eq('external_id', item.external_id)
            .maybeSingle();

          let listingId = existing?.listing_id;

          if (!listingId) {
            // Create stub canonical
            const { data: newListing, error: cErr } = await supabase
              .from('listings')
              .insert({
                type: item.derived.type,
                operation: item.derived.operation,
                price: item.derived.price,
                size_m2: item.derived.size_m2,
                size_usable_m2: item.derived.size_m2,
                title: item.derived.title,
                city: item.derived.city || null,
                seller_type: item.derived.seller_type,
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
                is_active: true,
              })
              .select('id')
              .single();
            if (cErr) throw cErr;
            listingId = newListing.id;
          }

          // Upsert listing_sources
          const sourcePayload = {
            portal_id: portalId,
            external_id: item.external_id,
            listing_id: listingId,
            url: item.url,
            source_title: item.source_title,
            source_price: item.source_price,
            source_seller_name: item.source_seller_name,
            last_seen_at: new Date().toISOString(),
            is_active: true,
            raw_payload: item.raw_payload,
          };

          if (existing) {
            await supabase
              .from('listing_sources')
              .update(sourcePayload)
              .eq('id', existing.id);
            stats.updated_sources++;
          } else {
            await supabase
              .from('listing_sources')
              .insert(sourcePayload);
            stats.new_sources++;
          }

          // Insert image as photo if present (URL only — no download yet)
          if (item.derived.image_url) {
            await supabase
              .from('photos')
              .upsert({
                listing_id: listingId,
                url: item.derived.image_url,
                "order": 0,
                is_cover: true,
              }, { onConflict: 'listing_id,url' });
          }
        } catch (e) {
          console.error(`  ✗ ingest error for ${item.external_id}: ${e.message}`);
          stats.errors++;
          errors.push({ external_id: item.external_id, error: e.message });
        }
      }

      // Friendly delay between pages
      if (page < pages) await sleep(1500 + Math.random() * 1000);
    }

    // Finalize run
    await supabase
      .from('scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: stats.errors > 0 && stats.new_sources === 0 ? 'failed' : 'succeeded',
        ...stats,
        error_detail: errors.length ? errors.slice(0, 50) : null,
      })
      .eq('id', runId);

    console.log('\n📊 Summary:');
    console.log(`   pages_fetched:   ${stats.pages_fetched}`);
    console.log(`   listings_seen:   ${stats.listings_seen}`);
    console.log(`   new_sources:     ${stats.new_sources}`);
    console.log(`   updated_sources: ${stats.updated_sources}`);
    console.log(`   errors:          ${stats.errors}`);
    console.log('\n✅ Done.');
  } catch (e) {
    await supabase
      .from('scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        ...stats,
        error_detail: { fatal: e.message },
      })
      .eq('id', runId);
    console.error('💥 Fatal:', e);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
