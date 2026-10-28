(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  /* drawers / menus */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]'); if (t) { const id = t.dataset.toggle === 'drawer' ? 'drawer' : t.dataset.toggle; const el = document.getElementById(id); if (el) { if (id === 'admnav') el.classList.toggle('open'); else el.hidden = !el.hidden; } }
    if (e.target.id === 'drawer') e.target.hidden = true;
    const pb = e.target.closest('[data-print]'); if (pb) window.print();
    const g = e.target.closest('[data-gal]'); if (g) { const big = $('.gal-big'); if (big) { big.src = g.dataset.gal; big.alt = g.dataset.alt || ''; } }
    if (!e.target.closest('.acct')) $$('.acct[open]').forEach((d) => d.removeAttribute('open'));
    if (!e.target.closest('.search')) { const b = $('#suggest-box'); if (b) b.hidden = true; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const d = $('#drawer'); if (d) d.hidden = true; const b = $('#suggest-box'); if (b) b.hidden = true; } });
  /* confirmation for destructive actions */
  document.addEventListener('submit', (e) => { const m = e.target.dataset.confirm || (e.submitter && e.submitter.dataset.confirm); if (m && !window.confirm(m)) e.preventDefault(); });
  /* search autocomplete (debounced) */
  const inp = $('[data-suggest]'), box = $('#suggest-box');
  if (inp && box) {
    let timer, ctl;
    inp.addEventListener('input', () => {
      clearTimeout(timer); const v = inp.value.trim();
      if (v.length < 2) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        if (ctl) ctl.abort(); ctl = new AbortController();
        try {
          const r = await fetch('/api/suggest?q=' + encodeURIComponent(v), { signal: ctl.signal, headers: { accept: 'application/json' } }); const d = await r.json();
          box.textContent = '';
          const add = (href, text, sub) => { const a = document.createElement('a'); a.href = href; a.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; a.append(s); } box.append(a); };
          d.products.forEach((p) => add('/p/' + p.slug, p.name, '\u20B9' + (p.eff_price / 100).toLocaleString('en-IN')));
          d.categories.forEach((c) => add('/c/' + c.slug, c.name, 'Category'));
          if (!box.children.length) add('/search?q=' + encodeURIComponent(v), 'Search for "' + v + '"');
          box.hidden = false;
        } catch (_) { /* aborted */ }
      }, 220);
    });
  }
  /* hero slider */
  $$('[data-hero]').forEach((h) => {
    const slides = $$('.slide', h); if (slides.length < 2) return; let i = 0, timer;
    const go = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, k) => { s.hidden = k !== i; }); $$('[data-dot]', h).forEach((d, k) => d.classList.toggle('on', k === i)); };
    const auto = () => { clearInterval(timer); const s = Number(h.dataset.autoplay) || 6; if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => go(i + 1), s * 1000); };
    h.addEventListener('click', (e) => { if (e.target.closest('[data-next]')) go(i + 1); else if (e.target.closest('[data-prev]')) go(i - 1); else { const d = e.target.closest('[data-dot]'); if (d) go(Number(d.dataset.dot)); else return; } auto(); });
    h.addEventListener('mouseenter', () => clearInterval(timer)); h.addEventListener('mouseleave', auto); auto();
  });
  /* countdowns for genuinely scheduled offers (server also enforces expiry) */
  const cds = $$('[data-end]');
  if (cds.length) { const tick = () => cds.forEach((c) => { const ms = Date.parse(c.dataset.end) - Date.now(); const b = $('b', c); if (ms <= 0) { c.textContent = 'This offer has ended'; return; } const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60; b.textContent = (d ? d + 'd ' : '') + [h, m, s].map((x) => String(x).padStart(2, '0')).join(':'); }); tick(); setInterval(tick, 1000); }
  /* PIN check */
  const pin = $('[data-pin]'), msg = $('[data-pin-msg]');
  if (pin && msg) {
    const check = async () => { if (!/^\d{6}$/.test(pin.value)) { msg.textContent = 'Enter a valid 6-digit PIN code.'; msg.className = 'small err-t'; return; } const r = await (await fetch('/api/pin?pin=' + pin.value)).json(); msg.textContent = r.msg; msg.className = 'small ' + (r.ok ? 'ok-t' : 'err-t'); };
    pin.addEventListener('change', () => { if (pin.value.length === 6) check(); }); const b = $('[data-pin-btn]'); if (b) b.addEventListener('click', check);
  }
  /* saved address picker at checkout */
  const pick = $('[data-addr-pick]');
  if (pick) pick.addEventListener('change', () => { const o = pick.selectedOptions[0], f = pick.form; if (!o || !o.value) return; const set = (n, v) => { f.elements[n].value = v; }; set('name', o.dataset.n); set('phone', o.dataset.p); set('line1', o.dataset.l1); set('line2', o.dataset.l2); set('city', o.dataset.c); set('state', o.dataset.s); set('pin', o.dataset.z); });
  /* Razorpay checkout (only when configured; payment is confirmed server-side by signature + webhook) */
  const rz = $('#rzp-btn');
  if (rz) rz.addEventListener('click', async () => {
    const out = $('#rzp-msg'); rz.disabled = true; out.textContent = 'Starting secure payment...';
    try {
      const h = { 'content-type': 'application/json', 'x-csrf-token': rz.dataset.csrf };
      const r = await fetch('/pay/' + rz.dataset.number + '/razorpay', { method: 'POST', headers: h, body: '{}' }); const o = await r.json();
      if (!r.ok) throw new Error(o.error || 'Could not start payment');
      new window.Razorpay({ key: o.key, amount: o.amount, currency: o.currency, name: o.name, order_id: o.order_id,
        handler: async (resp) => { out.textContent = 'Verifying payment...'; const v = await fetch('/pay/' + rz.dataset.number + '/razorpay/verify', { method: 'POST', headers: h, body: JSON.stringify(resp) }); const j = await v.json(); if (j.ok) location.href = j.redirect; else { out.textContent = j.error || 'Verification failed'; rz.disabled = false; } },
        modal: { ondismiss: () => { rz.disabled = false; out.textContent = ''; } } }).open();
    } catch (err) { out.textContent = err.message; rz.disabled = false; }
  });
})();
