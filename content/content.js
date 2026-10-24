// Runs on LinkedIn profile pages. Reads the public text from the top of the profile,
// asks the background worker for a market salary estimate for that role, and shows a small card.

(function () {
  const PANEL_ID = 'lse-panel';

  // The slug that identifies the profile we are looking at, e.g. "/in/john-doe/".
  const profileKey = () => (location.pathname.match(/\/in\/[^/]+/) || [''])[0];

  // Collapse the duplicated lines LinkedIn renders for screen readers, keep order.
  function cleanLines(text, max) {
    const seen = new Set();
    const out = [];
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
      if (out.length >= max) break;
    }
    return out.join('\n');
  }

  // Build a profile summary for the model from the whole career, not just the current title.
  // The name is left out on purpose: it adds nothing to a market estimate and keeps the
  // request about a role/experience profile rather than a named individual.
  // LinkedIn changes its markup often, so this tries precise selectors first and falls back
  // to the readable text of the main column if they do not match.
  function readProfileText() {
    const main = document.querySelector('main') || document.body;
    const parts = [];

    // Headline: the line under the name. Try a few known class names, then a heuristic.
    const headline =
      main.querySelector('.text-body-medium.break-words') ||
      main.querySelector('div.text-body-medium');
    if (headline && headline.textContent.trim()) parts.push('Headline: ' + headline.textContent.trim());

    // Location: small muted line in the top card.
    const loc =
      main.querySelector('.text-body-small.inline.t-black--light.break-words') ||
      main.querySelector('span.text-body-small.t-black--light');
    if (loc && loc.textContent.trim()) parts.push('Location: ' + loc.textContent.trim());

    // Profile sections are anchored by id (#experience, #education, #skills).
    const section = (anchorId, label) => {
      const anchor = document.getElementById(anchorId);
      const sec = anchor?.closest('section') || anchor?.parentElement;
      if (sec && sec.innerText.trim()) parts.push(label + ':\n' + cleanLines(sec.innerText, 40));
    };
    section('experience', 'Experience');
    section('education', 'Education');
    section('skills', 'Skills');

    // If the precise selectors found almost nothing, fall back to the whole main column.
    const haveSections = parts.some((p) => p.startsWith('Experience'));
    if (!haveSections) {
      const dump = cleanLines(main.innerText || '', 120);
      if (dump.length > 80) return (parts.length ? parts.join('\n\n') + '\n\n' : '') + 'Profile:\n' + dump;
    }

    const text = parts.join('\n\n');
    return text.trim().length > 20 ? text : null;
  }

  function fmtMoney(n, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency, maximumFractionDigits: 0
      }).format(n);
    } catch (_) {
      return Math.round(n).toLocaleString() + ' ' + currency;
    }
  }

  const ERRORS = {
    no_key: 'Add your free API key in the extension options first.',
    bad_key: 'That API key was rejected. Check it in the options.',
    rate_limit: 'The provider is rate limiting the free tier. Wait a bit and try again.',
    network: 'Could not reach the provider. Check your connection.',
    server: 'The provider returned an error. Try again later.',
    bad_response: 'Could not read the provider\'s answer.',
    empty: 'The provider returned nothing. Try again.',
    blocked: 'The provider stopped before answering.',
    timeout: 'The provider took too long. Try again.',
    noprofile: 'Could not read this profile. Open it fully and try again.'
  };

  function panel() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML = `
      <div class="lse-head">
        <span class="lse-dot"></span>
        <strong>Salary estimate</strong>
        <button class="lse-x" title="Close" aria-label="Close">&times;</button>
      </div>
      <div class="lse-body"></div>`;
    document.body.appendChild(el);
    el.querySelector('.lse-x').addEventListener('click', () => el.remove());
    return el;
  }

  function showButton() {
    const el = panel();
    el.querySelector('.lse-body').innerHTML = `
      <button class="lse-go">Estimate market salary</button>`;
    el.querySelector('.lse-go').addEventListener('click', run);
  }

  function showLoading() {
    panel().querySelector('.lse-body').innerHTML = `<p class="lse-muted">Estimating…</p>`;
  }

  function showError(code, detail) {
    const el = panel();
    const extra = detail ? ` <span class="lse-muted">(${detail})</span>` : '';
    el.querySelector('.lse-body').innerHTML =
      `<p class="lse-err">${ERRORS[code] || 'Something went wrong.'}${extra}</p>
       <button class="lse-go">Try again</button>`;
    el.querySelector('.lse-go').addEventListener('click', run);
  }

  function showResult(d) {
    const range = (d.min && d.max)
      ? `${fmtMoney(d.min, d.currency)} – ${fmtMoney(d.max, d.currency)}`
      : 'Not enough info';
    const el = panel();
    el.querySelector('.lse-body').innerHTML = `
      <div class="lse-range">${range}</div>
      <div class="lse-sub">${[d.role, d.location].filter(Boolean).join(' · ')}</div>
      <div class="lse-conf">Confidence: ${d.confidence || 'low'}${d.seniority ? ' · ' + d.seniority : ''}${d.years ? ' · ' + d.years + 'y exp' : ''}</div>
      ${d.notes ? `<p class="lse-muted">${d.notes}</p>` : ''}
      <p class="lse-fine">Market estimate, not actual pay.</p>
      <button class="lse-link" type="button">Re-estimate</button>`;
    el.querySelector('.lse-link').addEventListener('click', run);
  }

  async function run() {
    showLoading();
    const text = readProfileText();
    if (!text) { showError('noprofile'); return; }

    // Safety net: if the worker never answers (e.g. it was suspended), do not spin forever.
    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; showError('timeout'); } }, 40000);

    chrome.runtime.sendMessage({ cmd: 'estimate', profileText: text }, (res) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (chrome.runtime.lastError || !res) { showError('network', chrome.runtime.lastError?.message); return; }
      if (!res.ok) { showError(res.error || 'server', res.detail); return; }
      chrome.storage.local.set({ ['cache:' + profileKey()]: { at: Date.now(), data: res.data } });
      showResult(res.data);
    });
  }

  // Show cached result for this profile if we have one, otherwise the button.
  async function init() {
    const key = 'cache:' + profileKey();
    const store = await chrome.storage.local.get(key);
    const hit = store[key];
    if (hit && Date.now() - hit.at < 1000 * 60 * 60 * 24 * 30) showResult(hit.data);
    else showButton();
  }

  // LinkedIn is a single-page app: re-init when the profile in the URL changes.
  let last = profileKey();
  const reinit = () => {
    const now = profileKey();
    if (!now) { document.getElementById(PANEL_ID)?.remove(); return; }
    if (now !== last) { last = now; document.getElementById(PANEL_ID)?.remove(); init(); }
  };
  setInterval(reinit, 1000);

  if (profileKey()) init();
})();
