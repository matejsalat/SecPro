const { fetchPage, extractPrice, stripTags, makeId, normalizeLocation, extractPhones } = require('./utils');

// Map type to bazos category
const TYPE_MAP = {
  'byt': 'byt',
  'dom': 'dom',
  'pozemok': 'pozemky',
  'iny': ''
};

async function scrape({ location, priceMin, priceMax, type, page }) {
  const cat = TYPE_MAP[type] || 'byt';
  const offset = ((page || 1) - 1) * 20;

  // Build URL
  let url = `https://reality.bazos.sk/predam/${cat}/${offset > 0 ? offset + '/' : ''}`;
  const params = new URLSearchParams();
  if (location) params.set('hledat', location);
  if (priceMin) params.set('cession', priceMin);
  if (priceMax) params.set('cena_do', priceMax);
  const qs = params.toString();
  if (qs) url += '?' + qs;

  const html = await fetchPage(url);
  const results = [];

  // Bazos uses a simple structure: each listing is in a block with links to /inzerat/ID/
  // Pattern: <a href="/inzerat/12345/slug.php">Title</a> ... price € ... location
  const listingPattern = /<a[^>]*href="(\/inzerat\/(\d+)\/[^"]*)"[^>]*>([^<]+)<\/a>/g;
  let match;
  const listings = [];

  while ((match = listingPattern.exec(html)) !== null) {
    listings.push({ url: match[1], id: match[2], title: match[3] });
  }

  // For each listing, extract surrounding context for price and location
  for (const listing of listings) {
    // Find the block around this listing link
    const idx = html.indexOf(`/inzerat/${listing.id}/`);
    if (idx === -1) continue;

    // Get surrounding text (500 chars after the link)
    const block = html.substring(Math.max(0, idx - 200), idx + 600);
    const textBlock = stripTags(block);

    // Extract price
    const { price, priceText } = extractPrice(textBlock);

    // Extract location - usually city name and postal code
    const locMatch = textBlock.match(/(\d{3}\s?\d{2})\s+([A-ZÁ-Žá-ž\s]+)/);
    const loc = locMatch ? normalizeLocation(locMatch[2]) : '';

    // Extract phones from description
    const phones = extractPhones(textBlock);

    // Filter by price if specified
    if (priceMin && price && price < priceMin) continue;
    if (priceMax && price && price > priceMax) continue;

    // Filter by location if specified
    if (location && loc && !loc.toLowerCase().includes(location.toLowerCase()) &&
        !listing.title.toLowerCase().includes(location.toLowerCase())) continue;

    results.push({
      id: makeId('bazos', listing.id),
      source: 'bazos.sk',
      title: listing.title.trim(),
      address: '',
      location: loc,
      price: price,
      priceText: priceText || (price ? `${price} €` : 'Dohodou'),
      phone: phones.length > 0 ? phones[0] : null,
      url: `https://reality.bazos.sk${listing.url}`,
      type: type || 'byt',
      size: null,
      imageUrl: `https://www.bazos.sk/img/1t/${listing.id}.jpg`,
      scrapedAt: new Date().toISOString()
    });
  }

  return results.slice(0, 20);
}

module.exports = { scrape };
