const $ = (id) => document.getElementById(id);

chrome.storage.sync.get('geminiKey', ({ geminiKey }) => {
  if (geminiKey) $('key').value = geminiKey;
});

$('save').addEventListener('click', () => {
  const key = $('key').value.trim();
  chrome.storage.sync.set({ geminiKey: key }, () => {
    const msg = $('msg');
    msg.textContent = key ? 'Saved.' : 'Key cleared.';
    msg.className = 'msg ok';
  });
});

$('toggle').addEventListener('click', () => {
  const inp = $('key');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('toggle').textContent = show ? 'Hide' : 'Show';
});
