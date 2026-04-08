const { fetchPage, extractPhones, stripTags } = require('../lib/scrapers/utils');
const { handleCors } = require('../lib/kv');

module.exports = async function handler(req, res) {
  if (handleCors(req, res, 'GET, OPTIONS')) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const html = await fetchPage(url, 15000);
    const text = stripTags(html);

    // Extract phone numbers
    const phones = extractPhones(text);

    // Try to extract from specific patterns
    // bazos.sk: phone in table cells
    const bazosPhoneMatch = html.match(/Telef[oó]n[^<]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (bazosPhoneMatch) {
      const p = extractPhones(bazosPhoneMatch[1]);
      phones.push(...p);
    }

    // Generic: look for tel: links
    const telLinks = html.match(/href="tel:([^"]+)"/g);
    if (telLinks) {
      telLinks.forEach(t => {
        const num = t.match(/tel:([^"]+)/)?.[1];
        if (num) phones.push(num.replace(/\s/g, ' ').trim());
      });
    }

    // Look for myPhone JS variable (byty.sk pattern)
    const myPhoneMatch = html.match(/myPhone\s*=\s*['"]([^'"]+)['"]/);
    if (myPhoneMatch) phones.push(myPhoneMatch[1]);

    // Deduplicate
    const uniquePhones = [...new Set(phones.map(p => p.replace(/\s+/g, ' ').trim()))];

    // Extract description
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    const description = descMatch ? descMatch[1] : '';

    return res.status(200).json({
      phones: uniquePhones,
      description: description.substring(0, 500),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
