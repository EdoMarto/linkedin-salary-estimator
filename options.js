const $ = (id) => document.getElementById(id);

const DEFAULT_MODEL = {
  gemini: 'gemini-3.8-flash',
  groq: 'llama-3.1-8b-instant',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free'
};

// Model names that are retired or off the free tier, so a saved value is bumped on load.
const RETIRED = {
  'gemini-2.0-flash': 'gemini-3.8-flash',
  'gemini-1.5-flash': 'gemini-3.8-flash',
  'llama-3.3-70b-versatile': 'llama-3.1-8b-instant'
};

const KEY_HINT = {
  gemini: 'Free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>.',
  groq: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
  openrouter: 'Free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Pick a model ending in ":free".'
};

const MODEL_HINT = {
  gemini: 'e.g. gemini-3.8-flash or gemini-2.5-flash',
  groq: 'e.g. llama-3.1-8b-instant or openai/gpt-oss-20b (free tier)',
  openrouter: 'e.g. meta-llama/llama-3.3-70b-instruct:free'
};

let state = { provider: 'gemini', keys: {}, models: {} };

function paint() {
  const p = state.provider;
  $('provider').value = p;
  $('keyhint').innerHTML = KEY_HINT[p];
  $('modelhint').textContent = MODEL_HINT[p];
  $('key').value = state.keys[p] || '';
  $('model').value = state.models[p] || DEFAULT_MODEL[p];
  $('key').type = 'password';
  $('toggle').textContent = 'Show';
  $('msg').textContent = '';
  // The loaded list belongs to the previous provider, so hide it on switch.
  $('modelPick').hidden = true;
  $('modelmsg').textContent = '';
}

chrome.storage.sync.get(['provider', 'keys', 'models', 'geminiKey'], (v) => {
  state.provider = v.provider || 'gemini';
  state.keys = v.keys || {};
  state.models = v.models || {};
  // Carry over a key saved by the first version of the extension.
  if (!state.keys.gemini && v.geminiKey) state.keys.gemini = v.geminiKey;
  // Bump any retired model name to its replacement.
  for (const p of Object.keys(state.models)) {
    if (RETIRED[state.models[p]]) state.models[p] = RETIRED[state.models[p]];
  }
  paint();
});

$('provider').addEventListener('change', () => {
  // Keep what is typed for the current provider before switching.
  state.keys[state.provider] = $('key').value.trim();
  state.models[state.provider] = $('model').value.trim();
  state.provider = $('provider').value;
  paint();
});

$('toggle').addEventListener('click', () => {
  const inp = $('key');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('toggle').textContent = show ? 'Hide' : 'Show';
});

// Ask the chosen provider which models the current key can actually use, so the Model box
// offers real choices instead of a guessed id that may 404.
async function fetchModels(provider, key) {
  if (provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''));
  }
  const base = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1';
  const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).map((m) => m.id).filter(Boolean);
}

$('loadModels').addEventListener('click', async () => {
  const provider = $('provider').value;
  const key = $('key').value.trim();
  const msg = $('modelmsg');
  if (!key) { msg.textContent = 'Enter the API key first, then load models.'; msg.className = 'msg err'; return; }
  msg.textContent = 'Loading…'; msg.className = 'msg';
  try {
    let models = await fetchModels(provider, key);
    // Put free OpenRouter models first so they are easy to spot.
    models.sort((a, b) => (b.endsWith(':free') - a.endsWith(':free')) || a.localeCompare(b));
    const pick = $('modelPick');
    pick.innerHTML = '<option value="">Pick a model…</option>' +
      models.map((m) => `<option value="${m}">${m}</option>`).join('');
    pick.hidden = false;
    msg.textContent = models.length + ' models available. Pick one from the dropdown below.';
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = 'Could not load models (' + (e.message || e) + '). Check the key.';
    msg.className = 'msg err';
  }
});

// Choosing from the dropdown fills the Model box (which stays editable for manual ids).
$('modelPick').addEventListener('change', () => {
  if ($('modelPick').value) $('model').value = $('modelPick').value;
});

$('save').addEventListener('click', () => {
  const p = $('provider').value;
  state.provider = p;
  state.keys[p] = $('key').value.trim();
  state.models[p] = $('model').value.trim() || DEFAULT_MODEL[p];
  chrome.storage.sync.set({ provider: state.provider, keys: state.keys, models: state.models }, () => {
    const msg = $('msg');
    msg.textContent = state.keys[p] ? 'Saved.' : 'Saved, but no key for this provider yet.';
    msg.className = 'msg ' + (state.keys[p] ? 'ok' : 'err');
  });
});
