// Service worker: holds the API call so the content script never touches the key directly
// and so the request is not blocked by the page's CORS policy.
// Three providers are supported: Gemini (native API), Groq and OpenRouter (OpenAI-compatible).

const DEFAULT_MODEL = {
  gemini: 'gemini-3.8-flash',
  groq: 'llama-3.1-8b-instant',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free'
};

// Models that are retired or no longer on the free tier, mapped to a free replacement,
// so a saved old value self-heals instead of returning a 404.
const RETIRED = {
  'gemini-2.0-flash': 'gemini-3.8-flash',
  'gemini-1.5-flash': 'gemini-3.8-flash',
  'llama-3.3-70b-versatile': 'llama-3.1-8b-instant'
};

const SYSTEM = [
  'You estimate typical labour-market salaries for a professional PROFILE, not for a named individual.',
  'From the LinkedIn text, weigh the whole career: total years of experience, the roles held and how they',
  'progressed, the current role and seniority, the field, and the location.',
  'Give the typical GROSS ANNUAL salary range for someone with this background in that location\'s market.',
  'This is a market estimate for a person with this experience and seniority, from general knowledge of pay ranges.',
  'It is NOT the actual salary of any specific person, which is private and unknown to you.',
  'If the experience or location is unclear, widen the range and lower the confidence.',
  'Use the local currency of the location when you can.',
  'Reply with ONLY a JSON object with keys: role (string), seniority (string), years (number),',
  'location (string), currency (string ISO code), min (number), max (number),',
  'confidence (one of "low","medium","high"), notes (one short sentence on what drove the estimate).'
].join(' ');

const userText = (profileText) => 'LinkedIn profile:\n"""\n' + String(profileText).slice(0, 8000) + '\n"""';

// Gemini schema for structured output.
const geminiSchema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    seniority: { type: 'string' },
    years: { type: 'number' },
    location: { type: 'string' },
    currency: { type: 'string' },
    min: { type: 'number' },
    max: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' }
  },
  required: ['role', 'currency', 'min', 'max', 'confidence']
};

function mapStatus(status) {
  if (status === 400 || status === 401 || status === 403) return 'bad_key';
  if (status === 429) return 'rate_limit';
  return 'server';
}

// fetch that gives up after a while, so a hung request does not leave the card spinning forever.
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Turn a failed response into an error object that carries the status and the provider's message,
// so the card can show exactly what went wrong instead of a generic "try again later".
async function httpError(res) {
  let detail = String(res.status);
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    const msg = json?.error?.message || json?.message || json?.error;
    if (msg) detail += ': ' + String(msg).slice(0, 140);
  } catch (_) {}
  // Overload (503), gateway (502/504), generic 500 and rate limit (429) are worth a quick retry.
  const retryable = [429, 500, 502, 503, 504].includes(res.status);
  return { ok: false, error: mapStatus(res.status), detail, retryable };
}

// Pull the first {...} block out of a text answer, in case the model wraps it in prose or fences.
function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

async function callGemini(key, model, profileText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ parts: [{ text: userText(profileText) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512, responseMimeType: 'application/json', responseSchema: geminiSchema }
  };
  const res = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 60000);
  if (!res.ok) return httpError(res);
  const json = await res.json().catch(() => null);
  if (!json) return { ok: false, error: 'bad_response' };
  const blocked = json?.promptFeedback?.blockReason;
  if (blocked) return { ok: false, error: 'blocked', detail: blocked };
  const cand = json?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
  if (!text) {
    const reason = cand?.finishReason;
    if (reason && reason !== 'STOP') return { ok: false, error: 'blocked', detail: reason };
    return { ok: false, error: 'empty' };
  }
  const data = parseJson(text);
  return data ? { ok: true, data } : { ok: false, error: 'bad_response' };
}

// Groq and OpenRouter both speak the OpenAI chat-completions format.
async function callOpenAICompatible(url, key, model, profileText, extraHeaders) {
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userText(profileText) }
    ]
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, ...(extraHeaders || {}) },
    body: JSON.stringify(body)
  }, 60000);
  if (!res.ok) return httpError(res);
  const json = await res.json().catch(() => null);
  if (!json) return { ok: false, error: 'bad_response' };
  const text = json?.choices?.[0]?.message?.content || '';
  if (!text) {
    const reason = json?.choices?.[0]?.finish_reason;
    if (reason && reason !== 'stop') return { ok: false, error: 'blocked', detail: reason };
    return { ok: false, error: 'empty' };
  }
  const data = parseJson(text);
  return data ? { ok: true, data } : { ok: false, error: 'bad_response' };
}

async function estimate(profileText) {
  const cfg = await chrome.storage.sync.get(['provider', 'keys', 'models']);
  const provider = cfg.provider || 'gemini';
  const key = cfg.keys?.[provider];
  let model = (cfg.models?.[provider] || '').trim() || DEFAULT_MODEL[provider];
  if (RETIRED[model]) model = RETIRED[model];
  if (!key) return { ok: false, error: 'no_key' };

  const call = () => {
    if (provider === 'groq') return callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', key, model, profileText);
    if (provider === 'openrouter') return callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', key, model, profileText,
      { 'HTTP-Referer': 'https://github.com/EdoMarto/linkedin-salary-estimator', 'X-Title': 'Salary Estimator for LinkedIn' });
    return callGemini(key, model, profileText);
  };

  // Retry transient failures (overload, rate limit, 5xx) a couple of times with a growing pause.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      last = await call();
    } catch (e) {
      last = { ok: false, error: e?.name === 'AbortError' ? 'timeout' : 'network', retryable: e?.name !== 'AbortError' };
    }
    if (last.ok || !last.retryable) return last;
    if (attempt < 2) await sleep(1500 * (attempt + 1));
  }
  return last;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === 'estimate') {
    estimate(msg.profileText)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: 'network', detail: String(e?.message || e).slice(0, 120) }));
    return true; // keep the channel open for the async reply
  }
});
