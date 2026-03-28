module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { apiKey, model, property, sampleAds, mode } = req.body;

    if (!apiKey) return res.status(400).json({ error: 'API kľúč je povinný' });
    if (!property) return res.status(400).json({ error: 'Údaje o nehnuteľnosti sú povinné' });

    const selectedModel = model || 'claude-sonnet-4-6';

    // Build property details string
    const details = [];
    if (property.type) details.push(`Typ: ${property.type}`);
    if (property.city) details.push(`Mesto: ${property.city}`);
    if (property.district) details.push(`Okres: ${property.district}`);
    if (property.address) details.push(`Adresa: ${property.address}`);
    if (property.price) details.push(`Cena: ${Number(property.price).toLocaleString('sk-SK')} €`);
    if (property.size) details.push(`Výmera: ${property.size} m²`);
    if (property.rooms) details.push(`Počet izieb: ${property.rooms}`);
    if (property.floor) details.push(`Poschodie: ${property.floor}`);
    if (property.year) details.push(`Rok výstavby: ${property.year}`);
    if (property.condition) details.push(`Stav: ${property.condition}`);
    const detailsStr = details.join('\n');

    // Build sample ads context
    let sampleContext = '';
    if (sampleAds && sampleAds.length > 0) {
      sampleContext = `\n\nUžívateľ má nasledujúce vzorové inzeráty, ktoré ukazujú jeho štýl písania. Napodobni tento štýl - rovnaký tón, štruktúru, dĺžku a frázy:\n\n${sampleAds.map((ad, i) => `--- Vzor ${i + 1} ---\n${ad}`).join('\n\n')}`;
    }

    let systemPrompt, userPrompt;

    if (mode === 'headline') {
      systemPrompt = `Si expert na tvorbu titulkov realitných inzerátov na Slovensku. Tvor krátke, chytľavé, profesionálne titulky v slovenčine. Vráť LEN titulok, nič iné.${sampleContext}`;
      userPrompt = `Vytvor chytľavý titulok inzerátu pre túto nehnuteľnosť:\n\n${detailsStr}`;
    } else {
      systemPrompt = `Si expert na tvorbu realitných inzerátov na Slovensku. Píš profesionálne, predajné popisy nehnuteľností v slovenčine. Popis by mal byť informatívny, atraktívny a mal by zdôrazniť výhody nehnuteľnosti. Nepoužívaj klamlivé tvrdenia. Vráť LEN text popisu, bez titulku a bez úvodzoviek.${sampleContext}`;
      userPrompt = `Napíš profesionálny popis inzerátu pre túto nehnuteľnosť:\n\n${detailsStr}\n\nPopis by mal mať 3-5 odstavcov a mal by zahŕňať:\n- Úvodné zhrnutie\n- Popis dispozície a vybavenia\n- Okolie a občianska vybavenosť\n- Záver s výzvou`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: mode === 'headline' ? 100 : 1024,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `API chyba: ${response.status}`;
      return res.status(response.status).json({ error: errMsg });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return res.status(200).json({
      text: text.trim(),
      model: selectedModel,
      usage: data.usage || {},
    });
  } catch (err) {
    return res.status(500).json({ error: `Serverová chyba: ${err.message}` });
  }
};
