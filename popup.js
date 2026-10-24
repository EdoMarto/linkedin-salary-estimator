const status = document.getElementById('status');

chrome.storage.sync.get('geminiKey', ({ geminiKey }) => {
  if (geminiKey) { status.textContent = 'API key set'; status.className = 'status ok'; }
  else { status.textContent = 'No API key yet'; status.className = 'status no'; }
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
