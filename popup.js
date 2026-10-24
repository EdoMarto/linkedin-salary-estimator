const status = document.getElementById('status');
const NAMES = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter' };

chrome.storage.sync.get(['provider', 'keys', 'geminiKey'], (v) => {
  const provider = v.provider || 'gemini';
  const key = (v.keys && v.keys[provider]) || (provider === 'gemini' ? v.geminiKey : '');
  if (key) { status.textContent = NAMES[provider] + ' key set'; status.className = 'status ok'; }
  else { status.textContent = 'No API key for ' + NAMES[provider]; status.className = 'status no'; }
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
