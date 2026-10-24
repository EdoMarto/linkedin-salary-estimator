// Service worker: holds the Gemini call so the content script never touches the key directly
// and so the request is not blocked by the page's CORS policy.

const MODEL = 'gemini-2.0-flash';
const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

const SYSTEM = [
  'You estimate typical labour-market salaries for ROLES, not for individuals.',
  'From the LinkedIn profile text, work out the current role, seniority, company (if stated) and location.',
  'Then give the typical GROSS ANNUAL salary range for that kind of role in that location\'s market.',
  'This is a market estimate for the role and seniority, from general knowledge of pay ranges.',
  'It is NOT the actual salary of this specific person, which is private and unknown to you.',
  'If the role or location is unclear, widen the range and lower the confidence.',
  'Use the local currency of the location when you can.'
].join(' ');

const schema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    seniority: { type: 'string' },
    location: { type: 'string' },
    currency: { type: 'string', description: 'ISO code like EUR, USD, GBP' },
    min: { type: 'number', description: 'lower bound of yearly gross salary' },
    max: { type: 'number', description: 'upper bound of yearly gross salary' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string', description: 'one short sentence on what the estimate is based on' }
  },
  required: ['role', 'currency', 'min', 'max', 'confidence']
};

async function estimate(profileText) {
  const { geminiKey } = await chrome.storage.sync.get('geminiKey');
  if (!geminiKey) return { ok: false, error: 'no_key' };

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ parts: [{ text: 'Profile text:\n"""\n' + profileText.slice(0, 6000) + '\n"""' }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  let res;
  try {
    res = await fetch(ENDPOINT(MODEL, geminiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (_) {
    return { ok: false, error: 'network' };
  }

  if (res.status === 400 || res.status === 403) return { ok: false, error: 'bad_key' };
  if (res.status === 429) return { ok: false, error: 'rate_limit' };
  if (!res.ok) return { ok: false, error: 'server' };

  let json;
  try { json = await res.json(); } catch (_) { return { ok: false, error: 'bad_response' }; }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, error: 'empty' };

  let data;
  try { data = JSON.parse(text); } catch (_) { return { ok: false, error: 'bad_response' }; }
  return { ok: true, data };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === 'estimate') {
    estimate(msg.profileText).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
});
