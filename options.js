const $ = (id) => document.getElementById(id);

const DEFAULT_MODEL = {
  gemini: 'gemini-3.8-flash',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free'
};

// Old model names that providers have retired, so a saved value is bumped on load.
const RETIRED = { 'gemini-2.0-flash': 'gemini-3.8-flash', 'gemini-1.5-flash': 'gemini-3.8-flash' };

const KEY_HINT = {
  gemini: 'Free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>.',
  groq: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
  openrouter: 'Free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Pick a model ending in ":free".'
};

const MODEL_HINT = {
  gemini: 'e.g. gemini-3.8-flash or gemini-2.5-flash',
  groq: 'e.g. llama-3.3-70b-versatile or llama-3.1-8b-instant',
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
