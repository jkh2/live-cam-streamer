// Placeholder "My Gallery" view. Grok's richer version replaces this file.
// Contract: docs/gallery-integration.md
export function mountGallery(root, api) {
  let active = false, timer = null, unsub = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    const items = api.gallery.list();
    root.innerHTML = `
      <div class="g-head">
        <div><b>${items.length}</b> saved window${items.length === 1 ? '' : 's'}</div>
        <div class="g-actions">
          <button data-act="wall" ${items.length ? '' : 'disabled'}>▦ Watch wall</button>
          <button data-act="export" ${items.length ? '' : 'disabled'}>Export</button>
          <label class="g-import">Import<input type="file" accept="application/json,.json" hidden></label>
        </div>
      </div>
      ${items.length ? '' : `<div class="g-empty">No saved windows yet.<br>Open any light on the globe and press <b>★</b> to keep it here.</div>`}
      <div class="g-grid">
        ${items.map((c, i) => {
          const ls = api.lightState(c.lat, c.lon);
          return `<article class="g-tile" data-id="${esc(c.id)}">
            <div class="g-thumb" style="--d:${(i * 1.7) % 9}s">
              <img src="${api.thumbUrl(c.id, { size: 'mq', bust: true })}" alt="" loading="lazy">
              <span class="g-live">LIVE</span><span class="g-sun" title="${esc(ls.label)}">${ls.icon}</span>
            </div>
            <div class="g-meta">
              <div class="g-name">${esc(c.name)}</div>
              <div class="g-place">${c.approx ? '≈ ' : ''}${esc(c.place)}${c.country ? ' · ' + esc(c.country) : ''}${c.tz ? ' · ' + api.localTime(c.tz) : ''}</div>
              <div class="g-by">by <a href="${esc(c.channelUrl)}" target="_blank" rel="noopener">${esc(c.channel)}</a></div>
            </div>
            <button class="g-x" data-act="remove" title="Remove">✕</button>
          </article>`;
        }).join('')}
      </div>`;
  }

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    const tile = e.target.closest('.g-tile');
    if (btn?.dataset.act === 'remove' && tile) { api.gallery.remove(tile.dataset.id); return; }
    if (btn?.dataset.act === 'wall') { api.openWall(api.gallery.list().slice(0, 9).map(c => c.id)); return; }
    if (btn?.dataset.act === 'export') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([api.gallery.exportJSON()], { type: 'application/json' }));
      a.download = 'now-here-gallery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    if (tile && !e.target.closest('a')) {
      const cam = api.gallery.list().find(c => c.id === tile.dataset.id);
      if (cam) api.openCam(cam);
    }
  });

  root.addEventListener('change', async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const n = api.gallery.importJSON(await f.text()); api.toast(`Added ${n} cam${n === 1 ? '' : 's'}`); }
    catch (err) { api.toast('That file isn’t a Now Here gallery'); }
    e.target.value = '';
  });

  function refreshThumbs() {
    root.querySelectorAll('.g-tile img').forEach((img, i) => {
      setTimeout(() => {
        if (!active) return;
        const id = img.closest('.g-tile').dataset.id;
        const pre = new Image();
        pre.onload = () => { img.src = pre.src; };
        pre.src = api.thumbUrl(id, { size: 'mq', bust: true }) + '&r=' + Math.random().toString(36).slice(2, 6);
      }, i * 900);
    });
  }

  unsub = api.gallery.onChange(() => render());
  render();

  return {
    setActive(on) {
      active = on;
      clearInterval(timer);
      if (on) { render(); timer = setInterval(refreshThumbs, 75000); }
    },
    refresh: render,
    destroy() { clearInterval(timer); unsub && unsub(); root.innerHTML = ''; },
  };
}
