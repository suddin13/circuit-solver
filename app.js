(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    toggle: $('toggleSidebar'), newBtn: $('newChatBtn'), list: $('historyList'), empty: $('historyEmpty'),
    dropView: $('dropView'), dropzone: $('dropzone'), fileInput: $('fileInput'),
    chatView: $('chatView'), originalImg: $('originalImg'), thread: $('thread'),
    followForm: $('followForm'), followInput: $('followInput'),
    loading: $('loading'), error: $('error'),
    solEmpty: $('solutionEmpty'), solView: $('solutionView'), canvas: $('solutionCanvas'),
    summary: $('summary'), legend: $('legend'), steps: $('steps'), notes: $('notes'),
    download: $('downloadBtn'),
  };

  let current = null; // currently displayed chat object

  // ---------------------------------------------------------------- helpers
  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  const post = (url, body) =>
    api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const showError = (msg) => { el.error.textContent = msg || ''; el.error.hidden = !msg; };
  const setLoading = (on) => { el.loading.hidden = !on; };

  // Load ANY image the browser can decode, flatten onto white, downscale, return JPEG data URLs.
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = (max) => Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const render = (max, quality) => {
          const s = scale(max);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * s));
          c.height = Math.max(1, Math.round(img.naturalHeight * s));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', quality);
        };
        const out = { image: render(1568, 0.9), thumb: render(120, 0.7) };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Your browser couldn't read that image format. Try PNG, JPG, GIF, WebP, BMP or SVG."));
      };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- sidebar
  el.toggle.onclick = () => document.body.classList.toggle('sidebar-open');

  async function refreshHistory() {
    let chats = [];
    try { chats = await api('/api/chats'); } catch { /* ignore */ }
    el.list.innerHTML = '';
    el.empty.hidden = chats.length > 0;
    for (const c of chats) {
      const li = document.createElement('li');
      li.className = 'history-item' + (current && current.id === c.id ? ' active' : '');
      li.innerHTML = `
        <img alt="" src="${c.thumb || ''}" />
        <div class="meta"><div class="title"></div><div class="date"></div></div>
        <button class="del" title="Delete">✕</button>`;
      li.querySelector('.title').textContent = c.title || 'Circuit';
      li.querySelector('.date').textContent = new Date(c.createdAt).toLocaleString();
      li.onclick = () => openChat(c.id);
      li.querySelector('.del').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this chat?')) return;
        await api(`/api/chats/${c.id}`, { method: 'DELETE' });
        if (current && current.id === c.id) resetToDashboard();
        refreshHistory();
      };
      el.list.appendChild(li);
    }
  }

  async function openChat(id) {
    showError('');
    try {
      current = await api(`/api/chats/${id}`);
      renderChat();
      refreshHistory();
    } catch (err) { showError(err.message); }
  }

  function resetToDashboard() {
    current = null;
    showError('');
    el.chatView.hidden = true;
    el.dropView.hidden = false;
    el.solView.hidden = true;
    el.solEmpty.hidden = false;
    refreshHistory();
  }
  el.newBtn.onclick = resetToDashboard;

  // ---------------------------------------------------------------- upload
  el.dropzone.onclick = () => el.fileInput.click();
  el.dropzone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') el.fileInput.click(); };
  el.fileInput.onchange = () => { if (el.fileInput.files[0]) handleFile(el.fileInput.files[0]); el.fileInput.value = ''; };

  ['dragenter', 'dragover'].forEach((t) =>
    window.addEventListener(t, (e) => { e.preventDefault(); if (!el.dropView.hidden) el.dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) =>
    window.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.remove('over'); }));
  window.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files || [])][0];
    if (file) handleFile(file);
  });
  window.addEventListener('paste', (e) => {
    if (document.activeElement === el.followInput) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
    if (item) handleFile(item.getAsFile());
  });

  async function handleFile(file) {
    showError('');
    setLoading(true);
    try {
      const { image, thumb } = await loadImage(file);
      current = await post('/api/analyze', { image, thumb });
      renderChat();
      refreshHistory();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------- render
  function renderChat() {
    el.dropView.hidden = true;
    el.chatView.hidden = false;
    el.originalImg.src = current.image;
    renderThread();
    renderSolution();
  }

  function addMsg(role, text) {
    const d = document.createElement('div');
    d.className = `msg ${role}`;
    d.textContent = text;
    el.thread.appendChild(d);
  }

  function renderThread() {
    el.thread.innerHTML = '';
    const a = current.analysis;
    const lines = a.unknowns.map((u) => `${u.label} = ${u.value} ${u.unit || ''}`.trim());
    addMsg('system', `Analysis · ${a.summary || ''}\n${lines.length ? lines.join('\n') : 'No missing values found.'}`);
    for (const m of current.messages) addMsg(m.role, m.text);
  }

  el.followForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = el.followInput.value.trim();
    if (!text || !current) return;
    el.followInput.value = '';
    addMsg('user', text);
    addMsg('assistant', 'Thinking…');
    showError('');
    try {
      current = await post(`/api/chats/${current.id}/messages`, { text });
      renderThread();
    } catch (err) {
      renderThread();
      showError(err.message);
    }
  };

  // ---------------------------------------------------------------- solution canvas
  function renderSolution() {
    const a = current.analysis;
    el.solEmpty.hidden = true;
    el.solView.hidden = false;
    el.summary.textContent = a.summary || '';
    el.notes.textContent = [a.confidence ? `Confidence: ${a.confidence}.` : '', a.notes || ''].join(' ').trim();

    el.legend.innerHTML = '';
    if (!a.unknowns.length) {
      const li = document.createElement('li');
      li.textContent = 'No missing values were found in this image.';
      el.legend.appendChild(li);
    }
    for (const u of a.unknowns) {
      const li = document.createElement('li');
      const body = document.createElement('div');
      const head = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = u.label;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = ` = ${u.value} ${u.unit || ''}`;
      head.append(strong, val);
      const q = document.createElement('div');
      q.className = 'how';
      q.textContent = [u.quantity, u.how].filter(Boolean).join(' — ');
      body.append(head, q);
      li.appendChild(body);
      el.legend.appendChild(li);
    }
    el.steps.innerHTML = '';
    for (const s of a.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      el.steps.appendChild(li);
    }

    const img = new Image();
    img.onload = () => drawHighlights(img, a.unknowns);
    img.src = current.image;
  }

  function drawHighlights(img, unknowns) {
    const c = el.canvas;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const W = c.width, H = c.height;
    const fs = Math.max(14, Math.round(W / 38));
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const placed = [];

    unknowns.forEach((u, i) => {
      if (!u.bbox) return;
      const [nx, ny, nw, nh] = u.bbox;
      const pad = fs * 0.3;
      const x = nx * W - pad, y = ny * H - pad;
      const w = Math.max(nw * W, fs) + pad * 2, h = Math.max(nh * H, fs) + pad * 2;

      // highlighted box
      ctx.fillStyle = 'rgba(255, 214, 0, 0.30)';
      ctx.strokeStyle = '#fb8500';
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();

      // answer tag
      const text = `${i + 1}. ${u.label} = ${u.value} ${u.unit || ''}`.trim();
      const tw = ctx.measureText(text).width + fs;
      const th = fs * 1.6;
      let tx = Math.min(Math.max(2, x), W - tw - 2);
      let ty = y - th - 4;
      if (ty < 2) ty = y + h + 4;
      // nudge down/up if it overlaps an earlier tag
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((p) => tx < p.x + p.w && tx + tw > p.x && ty < p.y + p.h && ty + th > p.y);
        if (!hit) break;
        ty = hit.y + hit.h + 3;
      }
      ty = Math.min(ty, H - th - 2);
      placed.push({ x: tx, y: ty, w: tw, h: th });

      ctx.fillStyle = '#1a1200';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 8);
      ctx.fill();
      ctx.strokeStyle = '#ffb703';
      ctx.stroke();
      ctx.fillStyle = '#ffd60a';
      ctx.fillText(text, tx + fs / 2, ty + th / 2 + 1);
    });
  }

  el.download.onclick = () => {
    const a = document.createElement('a');
    a.href = el.canvas.toDataURL('image/png');
    a.download = 'solved-circuit.png';
    a.click();
  };

  // ---------------------------------------------------------------- init
  refreshHistory();
})();
