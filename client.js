// Giao diện trình duyệt: sảnh chờ, vẽ bản đồ, sương mù, minimap và điều khiển. Luật chơi nằm trong core.js.
(function () {
  'use strict';
  const C = window.ChienTruongCore;
  const COL = ['#2f6bff', '#ff3030', '#ff9f1a', '#b24dff', '#14c8c8'];
  const COL_RGB = [[47, 107, 255], [255, 48, 48], [255, 159, 26], [178, 77, 255], [20, 200, 200]];
  const DK = ['#14307a', '#7a1414', '#7a4a08', '#521a7a', '#0a5f5f'];
  const GOLD_C = '#ffd400';
  const KIND = ['Bộ binh', 'Thiết giáp', 'Giáo binh', 'Cung thủ', 'Kỵ binh', 'Chỉ huy'];
  const RADIUS = [0.42, 0.55, 0.42, 0.38, 0.5, 0.6];
  const VISION = [5, 6, 5, 6, 5, 5];   // tầm nhìn của quân (ô)
  const CITY_VISION = 7, TOWER_VISION = 6;
  const TPX = 8; // độ phân giải texture địa hình (px mỗi ô)

  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), g = cv.getContext('2d');
  const mini = $('mini'), mg = mini.getContext('2d');
  let ws = null, roomInfo = null, lock = null, S = null, slot = -1, tickMs = 50, lastStepAt = 0;
  let tcv = null, ov = null, fogc = null, facing = new Map(), vis = null;
  let cam = { x: 0, y: 0, z: 14 };
  let sel = [], selCity = null, dragging = null, box = null, boxMode = false, towerMode = false, prodFor = -1;

  // ---------- Kết nối và sảnh chờ ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      $('status').textContent = 'Đã kết nối';
      // Có phiên cũ (đang trong trận): tự kết nối lại bằng token.
      const sess = JSON.parse(localStorage.getItem('ct_session') || 'null');
      if (sess && sess.code && sess.token) send({ t: 'rejoin', code: sess.code, token: sess.token });
    };
    ws.onclose = () => { $('status').textContent = 'Mất kết nối'; if (lock) lock.stop(); };
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  $('create').onclick = () => send({ t: 'create', name: $('name').value || 'Người chơi' });
  $('join').onclick = () => send({ t: 'join', code: $('code').value.trim().toUpperCase(), name: $('name').value || 'Người chơi' });
  $('start').onclick = () => send({ t: 'start' });
  $('back').onclick = () => { localStorage.removeItem('ct_session'); location.reload(); };
  $('boxbtn').onclick = () => { boxMode = !boxMode; $('boxbtn').textContent = 'Chọn vùng: ' + (boxMode ? 'bật' : 'tắt'); $('boxbtn').classList.toggle('on', boxMode); };
  $('towerbtn').onclick = () => { towerMode = !towerMode; $('towerbtn').classList.toggle('on', towerMode); $('towerbtn').textContent = towerMode ? 'Chạm đất để đặt tháp' : 'Tháp canh: 30 vàng'; };
  $('clear').onclick = () => { sel = []; selCity = null; refreshPanels(); };
  document.querySelectorAll('#unitbar [data-f]').forEach(b => b.onclick = () => formCmd(Number(b.dataset.f)));
  $('disband').onclick = () => { if (lock && sel.length) lock.command({ type: 'disband', ids: ownSel() }); };
  $('atk').onclick = () => { if (lock && sel.length) lock.command({ type: 'stance', ids: ownSel(), st: 1 }); };
  $('def').onclick = () => { if (lock && sel.length) lock.command({ type: 'stance', ids: ownSel(), st: 0 }); };

  function renderRoom() {
    $('room').style.display = 'block';
    $('roomcode').textContent = roomInfo.code;
    $('players').innerHTML = roomInfo.players.map((n, i) => `<div class="pl"><span style="color:${COL[i]}">■</span> ${esc(n)}</div>`).join('');
    $('start').style.display = roomInfo.host === roomInfo.you ? 'block' : 'none';
  }

  function onMsg(m) {
    switch (m.t) {
      case 'room':
        if (m.error) {
          if (m.error === 'Không thể kết nối lại') localStorage.removeItem('ct_session');
          $('err').textContent = m.error; return;
        }
        $('err').textContent = '';
        if (m.token) localStorage.setItem('ct_session', JSON.stringify({ code: m.code, token: m.token }));
        roomInfo = m; renderRoom(); break;
      case 'start': beginGame(m); break;
      case 'resume': beginGame(m); break;
      case 'bundle': if (lock) lock.onBundle(m); break;
      case 'desync': showMsg('Lệch đồng bộ tại tick ' + m.tick + '. Hãy tải lại trang.'); break;
      case 'over': if (lock) lock.stop(); localStorage.removeItem('ct_session'); break;
    }
  }

  // ---------- Bắt đầu trận ----------
  function beginGame(m) {
    $('lobby').style.display = 'none';
    $('game').style.display = 'block';
    if (lock) lock.stop();
    slot = m.slot; tickMs = m.tickMs;
    lock = new Lockstep({ core: C, send, tickMs, onStep, onEnd });
    lock.start(m);
    S = lock.S;
    buildTerrain();
    buildOverlay();
    buildFog();
    const mine = S.cities.find(c => c.o === slot && c.cap) || S.cities.find(c => c.o === slot);
    if (mine) { cam.x = mine.cx + 0.5; cam.y = mine.cy + 0.5; }
    resize();
    refreshPanels();
    requestAnimationFrame(frame);
  }

  function onStep(state) {
    S = state;
    lastStepAt = performance.now();
    sel = sel.filter(id => S.units.some(u => u.id === id && u.hp > 0));
    if (selCity && selCity.o !== slot) selCity = null;
    if (S.tick % 10 === 0) { buildOverlay(); buildFog(); }
    refreshPanels();
  }

  function onEnd(state) {
    S = state;
    let text = 'Kết thúc';
    if (state.winner === slot) text = 'Chiến thắng!';
    else if (state.winner >= 0) text = 'Thất bại';
    showMsg(text);
  }

  function showMsg(text) { $('msgtext').textContent = text; $('msg').style.display = 'flex'; }

  // ---------- Dựng địa hình, lãnh thổ, sương mù ----------
  function nearWater(x, y) {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const nx = x + i, ny = y + j;
      if (nx < 0 || ny < 0 || nx >= C.W || ny >= C.H) continue;
      const k = S.map.terr[ny * C.W + nx];
      if (k === 0 || k === 4) return true;
    }
    return false;
  }
  function buildTerrain() {
    tcv = document.createElement('canvas');
    tcv.width = C.W * TPX; tcv.height = C.H * TPX;
    const t = tcv.getContext('2d');
    const base = ['#2b8de8', '#a6c553', '#3d8b37', '#8a8f94', '#1f74cc'];
    const rng = new C.Rng(S.seed ^ 0x51f1);
    for (let y = 0; y < C.H; y++) for (let x = 0; x < C.W; x++) {
      const k = S.map.terr[y * C.W + x];
      t.fillStyle = (k === 1 && nearWater(x, y)) ? '#e3d79b' : base[k];
      t.fillRect(x * TPX, y * TPX, TPX, TPX);
    }
    // Sông (chỉ hiển thị; cầu được ngầm định nên không chặn đường).
    t.lineCap = 'round'; t.lineJoin = 'round';
    for (const river of S.map.rivers || []) {
      t.beginPath();
      river.forEach((ci, i) => {
        const px = (ci % C.W) * TPX + TPX / 2, py = ((ci / C.W) | 0) * TPX + TPX / 2;
        if (i) t.lineTo(px, py); else t.moveTo(px, py);
      });
      t.strokeStyle = '#2b8de8'; t.lineWidth = TPX * 0.5; t.stroke();
    }
    for (let y = 0; y < C.H; y++) for (let x = 0; x < C.W; x++) {
      const k = S.map.terr[y * C.W + x];
      const px = x * TPX + TPX / 2, py = y * TPX + TPX / 2;
      if (k === 2 && rng.next() % 100 < 60) {
        t.fillStyle = '#245c2a'; t.beginPath(); t.arc(px, py, TPX * 0.9, 0, Math.PI * 2); t.fill();
        t.fillStyle = '#3d8b37'; t.beginPath(); t.arc(px - 1, py + 1, TPX * 0.5, 0, Math.PI * 2); t.fill();
      } else if (k === 3 && rng.next() % 100 < 60) {
        t.fillStyle = '#6a7076'; t.beginPath(); t.arc(px, py, TPX * 0.85, 0, Math.PI * 2); t.fill();
        t.fillStyle = '#9aa0a6'; t.beginPath(); t.arc(px - 1, py - 1, TPX * 0.45, 0, Math.PI * 2); t.fill();
      }
    }
  }
  function buildOverlay() {
    if (!ov) { ov = document.createElement('canvas'); ov.width = C.W; ov.height = C.H; }
    const og = ov.getContext('2d');
    const img = og.createImageData(C.W, C.H), d = img.data;
    for (let y = 0; y < C.H; y++) for (let x = 0; x < C.W; x++) {
      const i = y * C.W + x, k = S.map.terr[i];
      if (k === 0 || k === 4) { d[i * 4 + 3] = 0; continue; }
      let best = null, bd = Infinity;
      for (const c of S.cities) {
        const dx = c.cx - x, dy = c.cy - y, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = c; }
      }
      if (!best) { d[i * 4 + 3] = 0; continue; }
      const rgb = COL_RGB[best.o];
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 70;
    }
    og.putImageData(img, 0, 0);
  }
  // Sương mù: ô nằm ngoài tầm nhìn của mình sẽ bị phủ tối.
  function buildFog() {
    vis = new Uint8Array(C.W * C.H);
    const mark = (cx, cy, r) => {
      for (let y = Math.max(0, cy - r); y <= Math.min(C.H - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(C.W - 1, cx + r); x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) vis[y * C.W + x] = 1;
    };
    for (const c of S.cities) if (c.o === slot) mark(c.cx, c.cy, CITY_VISION);
    for (const t of S.towers) if (t.o === slot && t.hp > 0) mark(Math.floor(t.x / C.CELL), Math.floor(t.y / C.CELL), TOWER_VISION);
    for (const u of S.units) if (u.o === slot && u.hp > 0) mark(Math.floor(u.x / C.CELL), Math.floor(u.y / C.CELL), VISION[u.k]);
    if (!fogc) { fogc = document.createElement('canvas'); fogc.width = C.W; fogc.height = C.H; }
    const fg = fogc.getContext('2d');
    const img = fg.createImageData(C.W, C.H), d = img.data;
    for (let i = 0; i < C.W * C.H; i++) { d[i * 4 + 3] = vis[i] ? 0 : 130; }
    fg.putImageData(img, 0, 0);
  }
  function visibleAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= C.W || cy >= C.H || !vis) return false;
    return vis[cy * C.W + cx] === 1;
  }

  // ---------- Vẽ ----------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(window.innerWidth * dpr);
    cv.height = Math.floor(window.innerHeight * dpr);
    cv.style.width = window.innerWidth + 'px';
    cv.style.height = window.innerHeight + 'px';
  }
  window.addEventListener('resize', () => { if (S) resize(); });

  function poly(pts) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
  }
  function star(x, y, outer, inner) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? inner : outer;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return pts;
  }
  function shapePath(kind, x, y, R, fx, fy) {
    const a = Math.atan2(fy, fx);
    if (kind === 0) { g.beginPath(); g.rect(x - R, y - R, 2 * R, 2 * R); return; }
    if (kind === 1) {
      const pts = []; for (let i = 0; i < 6; i++) { const q = i * Math.PI / 3; pts.push([x + Math.cos(q) * R * 1.15, y + Math.sin(q) * R * 1.15]); }
      poly(pts); return;
    }
    if (kind === 2) {
      const r = R * 1.3;
      poly([[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r], [x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r]]);
      return;
    }
    if (kind === 3) { poly([[x, y - R * 1.3], [x + R, y], [x, y + R * 1.3], [x - R, y]]); return; }
    if (kind === 4) {
      const r = R * 1.5;
      poly([[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a + 2.5) * r, y + Math.sin(a + 2.5) * r],
        [x + Math.cos(a + Math.PI) * r * 0.4, y + Math.sin(a + Math.PI) * r * 0.4], [x + Math.cos(a - 2.5) * r, y + Math.sin(a - 2.5) * r]]);
      return;
    }
    poly(star(x, y, R * 1.6, R * 0.7));
  }
  function hpBar(x, y, w, frac) {
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - w / 2, y, w, 0.12);
    g.fillStyle = frac > 0.5 ? '#33cc33' : frac > 0.25 ? '#ffcc33' : '#ff3333';
    g.fillRect(x - w / 2, y, w * Math.max(0, frac), 0.12);
  }

  function frame() { if (S) draw(); requestAnimationFrame(frame); }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    const z = cam.z, ox = w / 2 - cam.x * z, oy = h / 2 - cam.y * z;
    const alpha = Math.min(1, Math.max(0, (performance.now() - lastStepAt) / tickMs));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#173a5e'; g.fillRect(0, 0, w, h);
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    g.imageSmoothingEnabled = true;
    g.drawImage(tcv, 0, 0, C.W, C.H);
    g.globalAlpha = 0.85; g.drawImage(ov, 0, 0, C.W, C.H); g.globalAlpha = 1;

    // Đường nối đội hình tới tâm
    for (const grp of S.groups) {
      const mem = S.units.filter(u => grp.mem.includes(u.id) && u.hp > 0);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.05;
      for (const u of mem) { g.beginPath(); g.moveTo(u.x / C.CELL, u.y / C.CELL); g.lineTo(grp.cx / C.CELL, grp.cy / C.CELL); g.stroke(); }
    }

    // Tháp canh
    for (const t of S.towers) {
      const x = t.x / C.CELL, y = t.y / C.CELL;
      if (t.o !== slot && !visibleAt(x, y)) continue;
      g.fillStyle = COL[t.o]; g.fillRect(x - 0.5, y - 0.4, 1, 0.9);
      poly([[x - 0.75, y - 0.4], [x, y - 1.0], [x + 0.75, y - 0.4]]); g.fillStyle = DK[t.o]; g.fill();
      g.lineWidth = 0.07; g.strokeStyle = 'rgba(0,0,0,.9)'; g.strokeRect(x - 0.5, y - 0.4, 1, 0.9);
      if (t.hp < 5000) hpBar(x, y - 1.3, 1.0, t.hp / 5000);
    }

    // Thành
    for (const c of S.cities) {
      const x = c.cx + 0.5, y = c.cy + 0.5;
      const R = c.cap ? 0.95 : 0.6;
      if (c.cap) poly(star(x, y, R, R * 0.43)); else { g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); }
      g.fillStyle = COL[c.o]; g.fill();
      g.lineWidth = 0.08 + c.wl * 0.06; g.strokeStyle = c.wl ? '#333' : 'rgba(0,0,0,.9)'; g.stroke();
      if (c.cap && c.home === c.o) { g.beginPath(); g.arc(x, y, R + 0.3, 0, Math.PI * 2); g.strokeStyle = GOLD_C; g.lineWidth = 0.08; g.stroke(); }
      if (c === selCity) { g.beginPath(); g.arc(x, y, R + 0.5, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 0.1; g.stroke(); }
      const maxHp = C.cityMax(c);
      if (c.hp < maxHp) hpBar(x, y - R - 0.3, 1.6, c.hp / maxHp);
    }

    // Quân (địch ngoài tầm nhìn bị ẩn)
    for (const u of S.units) {
      if (u.hp <= 0) continue;
      const ux = u.x / C.CELL, uy = u.y / C.CELL;
      if (u.o !== slot && !visibleAt(ux, uy)) continue;
      const prev = lock.prevPos.get(u.id);
      const px = prev ? prev.x : u.x, py = prev ? prev.y : u.y;
      const x = (px + (u.x - px) * alpha) / C.CELL, y = (py + (u.y - py) * alpha) / C.CELL;
      if (prev && (u.x !== px || u.y !== py)) facing.set(u.id, [u.fx, u.fy]);
      const f = facing.get(u.id) || [u.fx, u.fy];
      const R = RADIUS[u.k];
      shapePath(u.k, x, y, R, f[0], f[1]);
      if (u.k === 1 || u.k === 5) {
        g.fillStyle = DK[u.o]; g.fill();
        g.lineWidth = 0.09; g.strokeStyle = u.k === 5 ? GOLD_C : COL[u.o]; g.stroke();
        g.fillStyle = '#fff'; g.fillRect(x - R * 0.2, y - R * 0.2, R * 0.4, R * 0.4);
      } else {
        g.fillStyle = COL[u.o]; g.fill();
        g.lineWidth = 0.08; g.strokeStyle = 'rgba(0,0,0,.85)'; g.stroke();
        if (u.k === 3) { g.beginPath(); g.arc(x, y, R * 0.28, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill(); }
        if (u.k === 4) { g.beginPath(); g.arc(x, y, R * 0.28, 0, Math.PI * 2); g.fillStyle = GOLD_C; g.fill(); }
      }
      if (u.st === 0 && u.o === slot) { g.beginPath(); g.arc(x, y, R + 0.1, 0, Math.PI * 2); g.strokeStyle = '#8fd3ff'; g.lineWidth = 0.05; g.stroke(); }
      if (sel.includes(u.id)) { g.beginPath(); g.arc(x, y, R + 0.18, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 0.07; g.stroke(); }
      if (u.hp < C.UNITS[u.k].hp) hpBar(x, y - R - 0.25, 0.9, u.hp / C.UNITS[u.k].hp);
    }

    // Sương mù (phủ lên thế giới)
    g.globalAlpha = 1;
    g.drawImage(fogc, 0, 0, C.W, C.H);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (box) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); g.setLineDash([]); }
    drawMini();
  }

  function drawMini() {
    const mw = mini.width, mh = mini.height, sx = mw / C.W, sy = mh / C.H;
    mg.fillStyle = '#0e1218'; mg.fillRect(0, 0, mw, mh);
    mg.drawImage(tcv, 0, 0, mw, mh);
    mg.drawImage(fogc, 0, 0, mw, mh);
    for (const c of S.cities) { mg.fillStyle = COL[c.o]; mg.fillRect(c.cx * sx - 2, c.cy * sy - 2, 4, 4); }
    for (const u of S.units) {
      if (u.hp <= 0 || (u.o !== slot && !visibleAt(u.x / C.CELL, u.y / C.CELL))) continue;
      mg.fillStyle = COL[u.o]; mg.fillRect(u.x / C.CELL * sx - 1, u.y / C.CELL * sy - 1, 2, 2);
    }
    mg.strokeStyle = '#fff'; mg.lineWidth = 1;
    const vw = window.innerWidth / cam.z, vh = window.innerHeight / cam.z;
    mg.strokeRect((cam.x - vw / 2) * sx, (cam.y - vh / 2) * sy, vw * sx, vh * sy);
  }
  mini.addEventListener('pointerdown', (e) => {
    const r = mini.getBoundingClientRect();
    cam.x = (e.clientX - r.left) / r.width * C.W; cam.y = (e.clientY - r.top) / r.height * C.H;
    e.stopPropagation();
  });

  // ---------- HUD và bảng điều khiển ----------
  function ownSel() { return sel.filter(id => S.units.some(u => u.id === id && u.o === slot && u.hp > 0)); }
  function formCmd(type) { const ids = ownSel(); if (lock && ids.length >= 2) lock.command({ type: 'form', ids, ftype: type }); }

  function refreshPanels() {
    if (!S) return;
    const gold = Math.floor(S.gold[slot] / C.GOLD);
    const used = C.popUsed(S, slot), cap = C.popCap(S, slot);
    const cities = S.cities.filter(c => c.o === slot).length;
    const groups = S.groups.filter(gr => gr.o === slot).length;
    const towers = S.towers.filter(t => t.o === slot).length;
    const selText = sel.length ? `${sel.length} quân` : (selCity ? 'thành' : 'không');
    $('hud').innerHTML = `Vàng <b>${gold}</b><br>Quân ${used}/${cap} · Thành ${cities} · Tháp ${towers}<br>Đội hình: ${groups} · Đã chọn: ${selText}<br><span style="opacity:.6">Tick ${S.tick}</span>`;
    $('unitbar').style.display = sel.length ? 'flex' : 'none';
    const prod = $('prod');
    if (selCity && selCity.o === slot) {
      if (prodFor !== selCity.id) {
        prodFor = selCity.id;
        let html = `<div class="title">${selCity.cap ? 'Thủ đô' : 'Thành'} · hàng đợi ${selCity.q.length}/8 · tường ${selCity.wl}/3</div>`;
        for (let k = 0; k < 6; k++) {
          if (k === 5 && !selCity.cap) continue;
          html += `<button data-k="${k}">${KIND[k]}</button>`;
        }
        if (selCity.wl < 3) html += `<button data-wall="1">Xây tường (${(selCity.cap ? 120 : 60) * (selCity.wl + 1)} vàng)</button>`;
        prod.innerHTML = html;
        prod.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { if (lock && selCity) lock.command({ type: 'produce', city: selCity.id, k: Number(b.dataset.k) }); });
        prod.querySelectorAll('[data-wall]').forEach(b => b.onclick = () => { if (lock && selCity) lock.command({ type: 'wall', city: selCity.id }); });
      }
      prod.style.display = 'block';
    } else {
      prod.style.display = 'none';
      prodFor = -1;
    }
    $('boxbtn').classList.toggle('on', boxMode);
  }

  // ---------- Điều khiển ----------
  function screenToWorld(px, py) {
    return { x: (px - window.innerWidth / 2) / cam.z + cam.x, y: (py - window.innerHeight / 2) / cam.z + cam.y };
  }
  function zoomAt(px, py, f) {
    const w = screenToWorld(px, py);
    cam.z = Math.min(48, Math.max(6, cam.z * f));
    cam.x = w.x - (px - window.innerWidth / 2) / cam.z;
    cam.y = w.y - (py - window.innerHeight / 2) / cam.z;
  }
  function moveOrder(cx, cy) { if (lock && sel.length) lock.command({ type: 'move', ids: ownSel(), cx, cy }); }

  function onTap(px, py, btn, shift) {
    if (!S || S.ended) return;
    const w = screenToWorld(px, py);
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    if (btn === 2) { if (towerMode) return; moveOrder(cx, cy); return; }
    if (towerMode) {
      if (lock) lock.command({ type: 'tower', cx, cy });
      towerMode = false; $('towerbtn').classList.remove('on'); $('towerbtn').textContent = 'Tháp canh: 30 vàng';
      return;
    }
    let bu = null, bd = 1.2;
    for (const u of S.units) {
      if (u.hp <= 0 || u.o !== slot) continue;
      const d = Math.hypot(u.x / C.CELL - w.x, u.y / C.CELL - w.y);
      if (d < bd) { bd = d; bu = u; }
    }
    if (bu) {
      if (shift) { const i = sel.indexOf(bu.id); if (i >= 0) sel.splice(i, 1); else sel.push(bu.id); }
      else sel = [bu.id];
      selCity = null; refreshPanels(); return;
    }
    let bc = null, cd = 1.6;
    for (const c of S.cities) {
      const d = Math.hypot(c.cx + 0.5 - w.x, c.cy + 0.5 - w.y);
      if (d < cd) { cd = d; bc = c; }
    }
    if (bc) {
      if (bc.o === slot && sel.length === 0) { selCity = selCity === bc ? null : bc; refreshPanels(); return; }
      moveOrder(bc.cx, bc.cy); selCity = null; refreshPanels(); return;
    }
    if (sel.length) moveOrder(cx, cy);
    else selCity = null;
    refreshPanels();
  }

  function selectBox() {
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const a = screenToWorld(x0, y0), b = screenToWorld(x1, y1);
    sel = S.units.filter(u => u.o === slot && u.hp > 0 &&
      u.x / C.CELL >= a.x && u.x / C.CELL <= b.x && u.y / C.CELL >= a.y && u.y / C.CELL <= b.y).map(u => u.id);
    selCity = null; refreshPanels();
  }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    dragging = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, btn: e.button, shift: e.shiftKey };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    dragging.x = e.clientX; dragging.y = e.clientY;
    if (Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) > 6) dragging.moved = true;
    if (!dragging.moved) return;
    if (boxMode && dragging.btn === 0) box = { x0: dragging.x0, y0: dragging.y0, x1: e.clientX, y1: e.clientY };
    else { cam.x -= dx / cam.z; cam.y -= dy / cam.z; }
  });
  cv.addEventListener('pointerup', () => {
    if (!dragging) return;
    const d = dragging; dragging = null;
    if (!d.moved && d.btn === 0) onTap(d.x0, d.y0, 0, d.shift);
    else if (d.moved && box) selectBox();
    box = null;
  });
  cv.addEventListener('pointercancel', () => { dragging = null; box = null; });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); onTap(e.clientX, e.clientY, 2, false); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 0.87); }, { passive: false });

  connect();
})();
