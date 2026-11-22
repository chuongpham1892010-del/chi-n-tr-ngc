// Lõi mô phỏng tất định cho Chiến Trường (phiên bản 2). Dùng chung cho trình duyệt và bài kiểm tra.
// Quy tắc tất định:
//  - Không dùng Math.random, Date, performance, Math.sin/cos/pow/exp/log trong mô phỏng.
//    Chỉ dùng +, -, *, /, Math.floor/trunc/ceil/round/min/max/abs và Math.sqrt (IEEE chính xác, tất định).
//  - Vị trí tính bằng phần nghìn ô (1 ô = 1000). HP, sát thương, tiếp tế tính x100.
//  - Vàng tính bằng đơn vị GOLD (1 vàng = 2000). Thu nhập/giây x100 cũng là đơn vị GOLD cho mỗi tick.
//  - Tick cố định 20 tick/giây. Lệnh chỉ được áp dụng ở đầu tick.
(function (root) {
  'use strict';

  const CELL = 1000, TPS = 20, GOLD = 2000;
  const W = 120, H = 72;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const ACQUIRE = 10000, MELEE = 1400, CAPTURE_R = 2200, INF = 0x3fffffff;
  const MAX_QUEUE = 8;
  const TERRAIN_COST = [-1, 100, 160, 220, -1]; // 0 nước, 1 đồng bằng, 2 rừng, 3 núi, 4 nước sâu
  const START_ARMY = [0, 0, 0, 0, 2, 2, 3, 3, 4, 1, 0, 2];

  // Quân: hp, dmg (x100), ar (%), rg (tầm bắn, phần nghìn ô), cd (tick), sp (phần nghìn ô/tick),
  // cost (vàng), tr (tick huấn luyện), up (trọng số dân số và phí duy trì)
  const UNITS = [
    { name: 'Bộ binh',    hp: 4000,  dmg: 450, ar: 10, rg: 0,    cd: 16, sp: 150, cost: 14,  tr: 100, up: 1 },
    { name: 'Thiết giáp', hp: 8500,  dmg: 900, ar: 30, rg: 0,    cd: 18, sp: 110, cost: 45,  tr: 220, up: 4 },
    { name: 'Giáo binh',  hp: 4500,  dmg: 350, ar: 10, rg: 0,    cd: 16, sp: 140, cost: 16,  tr: 110, up: 1 },
    { name: 'Cung thủ',   hp: 3000,  dmg: 400, ar: 0,  rg: 4250, cd: 22, sp: 145, cost: 20,  tr: 120, up: 1 },
    { name: 'Kỵ binh',    hp: 6000,  dmg: 700, ar: 15, rg: 0,    cd: 18, sp: 275, cost: 40,  tr: 180, up: 3 },
    { name: 'Chỉ huy',    hp: 13000, dmg: 900, ar: 30, rg: 0,    cd: 18, sp: 110, cost: 150, tr: 900, up: 2 },
  ];
  const RANK = [2, 0, 1, 4, 3, 2.5]; // thứ tự xếp đội hình: thiết giáp trước, cung thủ sau

  // Chỉ huy và aura
  const AURA_R = 3500, AURA_MAX = 4, AURA_STEP = 0.2;
  // Đội hình: 1 Phalanx, 2 Hình nêm, 3 Vuông rỗng
  const FORM_SP = 800, FORM_ATK = [100, 105, 125, 90], FORM_SPD = [100, 75, 105, 80];
  // Tiếp tế (x100 mỗi tick): +30 khi trong lãnh thổ và không giao chiến, -6 khi ngoài lãnh thổ, thêm -48 khi giao chiến
  const SUP_MAX = 10000, SUP_LOW = 1000, SUP_MID = 2500, SUP_OK = 6000;
  // Thành, tháp, tường
  const CITY_SHOOT_R = 3750, CITY_REGEN = 10;          // hp x100 mỗi tick
  const TOWER_HP = 5000, TOWER_COST = 30, TOWER_RANGE = 3750, TOWER_DMG = 20, TOWER_REGEN = 10, TOWER_REACH = 1800, TOWER_SPACING = 1500;
  const LOST_UNIT = 2000;                              // quân đã mất tính theo đơn vị 1/2000 trọng số

  // ---------- RNG và hash (số nguyên thuần) ----------
  function Rng(seed) { this.s = (seed >>> 0) || 1; }
  Rng.prototype.next = function () { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s; };
  Rng.prototype.range = function (a, b) { return a + (this.next() % (b - a + 1)); };

  function mix(h) {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function hash3(x, y, s) { return mix((Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0); }
  function noise(x, y, s) {
    const gx = Math.floor(x / 8), gy = Math.floor(y / 8), fx = x - gx * 8, fy = y - gy * 8;
    const v00 = hash3(gx, gy, s) & 255, v10 = hash3(gx + 1, gy, s) & 255;
    const v01 = hash3(gx, gy + 1, s) & 255, v11 = hash3(gx + 1, gy + 1, s) & 255;
    return (v00 * (8 - fx) * (8 - fy) + v10 * fx * (8 - fy) + v01 * (8 - fx) * fy + v11 * fx * fy) >> 6;
  }

  // ---------- Bản đồ ----------
  function genMap(seed) {
    const n = W * H, terr = new Uint8Array(n), cost = new Int32Array(n);
    const s1 = (seed ^ 0x9e3779b9) | 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = Math.trunc((2 * x - W) * 1250 / W), b = Math.trunc((2 * y - H) * 1250 / H);
      const wob = Math.floor(noise(x, y, s1 + 11) * 500 / 255) - 250;
      const r2 = a * a + b * b;
      if (r2 * (1000 + wob) * (1000 + wob) < 1e12) {
        const e = noise(x, y, s1 + 21);
        terr[i] = e > 190 ? 3 : e > 150 ? 2 : 1;
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (terr[y * W + x] !== 0) continue;
      let near = false;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const nx = x + i, ny = y + j;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && terr[ny * W + nx] !== 0) near = true;
      }
      if (!near) terr[y * W + x] = 4;
    }
    for (let i = 0; i < n; i++) cost[i] = TERRAIN_COST[terr[i]];
    return { terr, cost, rivers: makeRivers(terr, seed) };
  }

  // Sông: đi từ núi ra nước, chọn đường bằng RNG có seed.
  function makeRivers(terr, seed) {
    const rng = new Rng((seed ^ 0x52697665) >>> 0), out = [];
    const isWater = (i) => terr[i] === 0 || terr[i] === 4;
    for (let r = 0; r < 2; r++) {
      let start = -1;
      for (let t = 0; t < 400 && start < 0; t++) { const i = rng.range(0, W * H - 1); if (terr[i] === 3) start = i; }
      if (start < 0) continue;
      const path = [start];
      let cur = start, dir = rng.range(0, 7);
      for (let steps = 0; steps < 120; steps++) {
        const cx = cur % W, cy = (cur / W) | 0, opts = [];
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], ny = cy + DY[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (path.includes(ni)) continue;
          opts.push([k, ni]);
        }
        if (!opts.length) break;
        const wa = opts.find(o => isWater(o[1]));
        if (wa) { path.push(wa[1]); break; }
        const cont = opts.find(o => o[0] === dir);
        const pick = (cont && rng.next() % 2 === 0) ? cont : opts[rng.next() % opts.length];
        dir = pick[0]; cur = pick[1]; path.push(cur);
      }
      out.push(path);
    }
    return out;
  }
  function findLand(map, px, py, rng) {
    const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    for (let r = 0; r < 30; r++) for (let t = 0; t < 4; t++) {
      const x = cl(px + rng.range(-r, r), 2, W - 3), y = cl(py + rng.range(-r, r), 2, H - 3);
      if (map.cost[y * W + x] > 0) return [x, y];
    }
    return [cl(px, 2, W - 3), cl(py, 2, H - 3)];
  }
  function nearestPassable(map, cx, cy) {
    for (let r = 0; r <= 20; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.abs(x - cx) !== r && Math.abs(y - cy) !== r) continue;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (map.cost[y * W + x] > 0) return y * W + x;
    }
    return -1;
  }
  function cellOf(x, y) { return Math.floor(y / CELL) * W + Math.floor(x / CELL); }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < W * CELL && y < H * CELL; }

  // ---------- Trạng thái ----------
  function cityMax(c) { return Math.floor((c.cap ? 100000 : 30000) * (100 + 40 * c.wl) / 100); }
  function addCity(S, cx, cy, o, cap) {
    const c = { id: S.cities.length, cx, cy, x: cx * CELL + 500, y: cy * CELL + 500, o, home: o, cap, wl: 0, hp: 0, q: [], pr: 0 };
    c.hp = cityMax(c);
    S.cities.push(c);
  }
  function addUnit(S, o, k, x, y) {
    S.units.push({ id: S.nextId++, o, k, x, y, hp: UNITS[k].hp, cd: 0, dest: -1, ord: 0,
      st: 1, su: SUP_MAX, fg: 0, eng: 0, fx: 1000, fy: 0, mo: 10000, rt: 0 });
  }

  function createState(opts) {
    const seed = (opts.seed >>> 0) || 1, players = opts.players || 3;
    const rng = new Rng(seed), map = genMap(seed);
    const S = {
      seed, players, tick: 0, rng, map,
      ai: (opts.ai ? opts.ai.slice() : Array.from({ length: players }, (_, p) => p > 0)),
      gold: new Array(players).fill(70 * GOLD), cm: new Array(players).fill(0), lost: new Array(players).fill(0),
      alive: new Array(players).fill(true), cities: [], units: [], towers: [], groups: [],
      nextId: 1, nextGroup: 1, winner: -1, ended: false, _flow: new Map(), _tgt: new Map(),
    };
    for (let p = 0; p < players; p++) {
      const px = Math.floor(W * (p + 1) / (players + 1)), py = Math.floor(H * (34 + (p % 2) * 30) / 100);
      const [cx, cy] = findLand(map, px, py, rng);
      addCity(S, cx, cy, p, true);
      for (let j = 0; j < 3; j++) {
        const [ox, oy] = findLand(map, cx + rng.range(-13, 13), cy + rng.range(-10, 10), rng);
        addCity(S, ox, oy, p, false);
      }
      const capCity = S.cities[S.cities.length - 4];
      for (const k of START_ARMY) addUnit(S, p, k, capCity.x + rng.range(-3000, 3000), capCity.y + rng.range(-3000, 3000));
      addUnit(S, p, 5, capCity.x + 3000, capCity.y);
    }
    return S;
  }

  // ---------- Dân số, sản xuất ----------
  function popCap(S, o) {
    let c = 0;
    for (const city of S.cities) if (city.o === o) c += city.home === o ? (city.cap ? 30 : 15) : (city.cap ? 8 : 3);
    return c;
  }
  function popUsed(S, o) {
    let c = Math.floor(S.lost[o] / LOST_UNIT);
    for (const city of S.cities) if (city.o === o) for (const k of city.q) c += UNITS[k].up;
    for (const u of S.units) if (u.o === o && u.hp > 0) c += UNITS[u.k].up;
    return c;
  }
  function tryQueue(S, city, k) {
    const o = city.o, def = UNITS[k];
    if (k === 5 && !city.cap) return false;
    if (city.q.length >= MAX_QUEUE) return false;
    if (popUsed(S, o) + def.up > popCap(S, o)) return false;
    const price = k === 5 ? 150 * (S.cm[o] + 1) : def.cost;
    if (S.gold[o] < price * GOLD) return false;
    S.gold[o] -= price * GOLD;
    if (k === 5) S.cm[o]++;
    city.q.push(k);
    return true;
  }

  // ---------- Đường đi ----------
  function canStep(map, cx, cy, k) {
    const nx = cx + DX[k], ny = cy + DY[k];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    if (map.cost[ny * W + nx] <= 0) return false;
    if (DX[k] !== 0 && DY[k] !== 0 && (map.cost[cy * W + nx] <= 0 || map.cost[ny * W + cx] <= 0)) return false;
    return true;
  }
  function flowField(S, goal) {
    const cached = S._flow.get(goal);
    if (cached) return cached;
    const map = S.map, n = W * H, M = n + 1;
    const dist = new Int32Array(n).fill(INF), inq = new Uint8Array(n), q = new Int32Array(M);
    let h = 0, t = 0;
    dist[goal] = 0; q[t] = goal; t = (t + 1) % M; inq[goal] = 1;
    while (h !== t) {
      const c = q[h]; h = (h + 1) % M; inq[c] = 0;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        if (!canStep(map, cx, cy, k)) continue;
        const nn = (cy + DY[k]) * W + (cx + DX[k]);
        const diag = DX[k] !== 0 && DY[k] !== 0;
        const nd = dist[c] + Math.floor(map.cost[nn] * (diag ? 141 : 100) / 100);
        if (nd < dist[nn]) { dist[nn] = nd; if (!inq[nn]) { inq[nn] = 1; q[t] = nn; t = (t + 1) % M; } }
      }
    }
    if (S._flow.size >= 64) S._flow.delete(S._flow.keys().next().value);
    S._flow.set(goal, dist);
    return dist;
  }
  function stepPos(x, y, tx, ty, sp) {
    const dx = tx - x, dy = ty - y, d2 = dx * dx + dy * dy;
    if (d2 <= sp * sp) return { x: tx, y: ty, arrived: true };
    const d = Math.sqrt(d2);
    return { x: x + Math.trunc(dx * sp / d), y: y + Math.trunc(dy * sp / d), arrived: false };
  }
  // Một bước theo trường khoảng cách tới ô đích. Trả về null nếu không còn đường.
  function flowStep(S, x, y, dest, sp) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cy * W + cx === dest) return stepPos(x, y, (dest % W) * CELL + 500, ((dest / W) | 0) * CELL + 500, sp);
    const f = flowField(S, dest), cur = cy * W + cx;
    let best = f[cur], bi = -1;
    for (let k = 0; k < 8; k++) {
      if (!canStep(S.map, cx, cy, k)) continue;
      const nn = (cy + DY[k]) * W + (cx + DX[k]);
      if (f[nn] < best) { best = f[nn]; bi = nn; }
    }
    if (bi < 0) return null;
    return stepPos(x, y, (bi % W) * CELL + 500, ((bi / W) | 0) * CELL + 500, sp);
  }
  function lineClear(map, ax, ay, bx, by) {
    const d = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const n = Math.ceil(d / 500);
    for (let i = 1; i <= n; i++) {
      const x = ax + Math.trunc((bx - ax) * i / n), y = ay + Math.trunc((by - ay) * i / n);
      if (!inMap(x, y) || map.cost[cellOf(x, y)] <= 0) return false;
    }
    return true;
  }
  function setPos(u, r) {
    const dx = r.x - u.x, dy = r.y - u.y;
    if (dx || dy) { const L = Math.sqrt(dx * dx + dy * dy); u.fx = Math.trunc(dx * 1000 / L); u.fy = Math.trunc(dy * 1000 / L); }
    u.x = r.x; u.y = r.y;
  }
  // Di chuyển một quân tới điểm (tx,ty): đi thẳng nếu thoáng, không thì đi theo đường.
  function moveToward(S, u, tx, ty, sp) {
    if (lineClear(S.map, u.x, u.y, tx, ty)) { setPos(u, stepPos(u.x, u.y, tx, ty, sp)); return true; }
    const dest = nearestPassable(S.map, Math.floor(tx / CELL), Math.floor(ty / CELL));
    if (dest < 0) return false;
    const r = flowStep(S, u.x, u.y, dest, sp);
    if (!r) return false;
    setPos(u, r);
    return true;
  }
  function moveAlongOrder(S, u) {
    const r = flowStep(S, u.x, u.y, u.dest, UNITS[u.k].sp);
    if (!r) { u.ord = 0; return; }
    setPos(u, r);
    if (r.arrived) u.ord = 0;
  }

  // ---------- Đội hình ----------
  function formSlots(type, n) {
    const SP = FORM_SP, s = [];
    if (type === 1) {
      const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2.2))), rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols, cnt = r < rows - 1 ? cols : n - (rows - 1) * cols;
        s.push([(rows - 1) * SP / 2 - r * SP, (c - (cnt - 1) / 2) * SP]);
      }
    } else if (type === 2) {
      const rows = Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2);
      let i = 0;
      for (let r = 0; r < rows && i < n; r++) {
        const cnt = Math.min(r + 1, n - i);
        for (let c = 0; c < cnt; c++, i++) s.push([(rows - 1) * SP / 2 - r * SP, (c - (cnt - 1) / 2) * SP]);
      }
    } else {
      const m = Math.max(3, Math.ceil(n / 4) + 1), P = 4 * (m - 1), h = (m - 1) * SP / 2, pt = [];
      for (let k = 0; k < P; k++) {
        const side = Math.floor(k / (m - 1)), q = Math.trunc((k % (m - 1)) / (m - 1) * 2 * h);
        pt.push(side === 0 ? [h, -h + q] : side === 1 ? [h - q, h] : side === 2 ? [-h, h - q] : [-h + q, -h]);
      }
      for (let i = 0; i < n; i++) s.push(pt[Math.floor(i * P / n)]);
    }
    s.sort((p, q) => (q[0] - p[0]) || (Math.abs(p[1]) - Math.abs(q[1])));
    return s;
  }
  function unitById(S, id) { return S.units.find(u => u.id === id) || null; }
  function groupById(S, id) { return S.groups.find(g => g.id === id) || null; }
  function dissolve(S, g) {
    for (const id of g.mem) { const u = unitById(S, id); if (u && u.fg === g.id) u.fg = 0; }
    S.groups = S.groups.filter(x => x !== g);
  }
  function leaveGroup(S, u) {
    if (!u.fg) return;
    const g = groupById(S, u.fg);
    u.fg = 0;
    if (!g) return;
    g.mem = g.mem.filter(id => id !== u.id);
    if (g.mem.length < 2) dissolve(S, g);
  }
  function nearestCity(S, x, y) {
    let best = null, bd = INF * 4;
    for (const c of S.cities) {
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function formUp(S, p, ids, type) {
    const list = ids.map(id => unitById(S, id)).filter(u => u && u.o === p && u.hp > 0);
    for (const u of list) leaveGroup(S, u);
    if (list.length < 2) return;
    let cx = 0, cy = 0;
    for (const u of list) { cx += u.x; cy += u.y; }
    cx = Math.floor(cx / list.length); cy = Math.floor(cy / list.length);
    const ec = nearestCity(S, cx, cy);
    let dx = 1000, dy = 0;
    if (ec && ec.o !== p) {
      const vx = ec.x - cx, vy = ec.y - cy, L = Math.sqrt(vx * vx + vy * vy);
      if (L > 0) { dx = Math.trunc(vx * 1000 / L); dy = Math.trunc(vy * 1000 / L); }
    }
    const g = { id: S.nextGroup++, o: p, type, mem: list.map(u => u.id), cx, cy, dx, dy, goal: -1, has: 0 };
    for (const u of list) u.fg = g.id;
    S.groups.push(g);
  }
  // Cập nhật đội hình: giữ đội hình hợp lệ, di chuyển tâm, tính vị trí slot cho từng quân.
  function updateGroups(S) {
    S._tgt = new Map();
    for (const g of S.groups.slice()) {
      g.mem = g.mem.filter(id => { const u = unitById(S, id); return u && u.hp > 0 && u.fg === g.id; });
      if (g.mem.length < 2) { dissolve(S, g); continue; }
      if (g.has) {
        let sp = INF;
        for (const id of g.mem) sp = Math.min(sp, UNITS[unitById(S, id).k].sp);
        sp = sp * FORM_SPD[g.type] / 100;
        const r = flowStep(S, g.cx, g.cy, g.goal, sp);
        if (!r) g.has = 0;
        else {
          const mx = r.x - g.cx, my = r.y - g.cy, L = Math.sqrt(mx * mx + my * my);
          if (L > 0) { g.dx = Math.trunc(mx * 1000 / L); g.dy = Math.trunc(my * 1000 / L); }
          g.cx = r.x; g.cy = r.y;
          if (r.arrived) g.has = 0;
        }
      }
      const mem = g.mem.map(id => unitById(S, id)).sort((a, b) => (RANK[a.k] - RANK[b.k]) || (a.id - b.id));
      const offs = formSlots(g.type, mem.length);
      for (let i = 0; i < mem.length; i++) {
        const ox = offs[i][0], oy = offs[i][1];
        S._tgt.set(mem[i].id, [g.cx + Math.trunc((g.dx * ox - g.dy * oy) / 1000), g.cy + Math.trunc((g.dy * ox + g.dx * oy) / 1000)]);
      }
    }
  }

  // ---------- Chiến đấu ----------
  function auraCount(S, u) {
    let k = 0;
    const R2 = AURA_R * AURA_R;
    for (const v of S.units) {
      if (v === u || v.hp <= 0 || v.o !== u.o || v.k !== 5) continue;
      const dx = v.x - u.x, dy = v.y - u.y;
      if (dx * dx + dy * dy < R2) k++;
    }
    return Math.min(k, AURA_MAX);
  }
  // Hệ số nhận sát thương theo hướng (dirm trong HTML). c = cos góc giữa hướng quay mặt của phòng thủ và hướng tới địch.
  function attackDot(d, a, fx, fy) {
    const vx = a.x - d.x, vy = a.y - d.y, L = Math.sqrt(vx * vx + vy * vy);
    return L > 0 ? (vx * fx + vy * fy) / (L * 1000) : 0;
  }
  function dirMult(c, gType) {
    let m = c < -0.5 ? 1.5 : c < 0.4 ? 1.25 : 1;
    if (gType === 1) m = c >= 0.4 ? 0.7 : m * 1.1;
    else if (gType === 2) m = c >= 0.4 ? 1 : m * 1.2;
    else if (gType === 3) m = 0.85;
    return m;
  }
  function hit(S, a, d) {
    const s = UNITS[a.k];
    let dmg = Math.floor(s.dmg * 50 * (100 - UNITS[d.k].ar) / 10000);
    let m = 1;
    if (a.st === 1) m *= 1 + AURA_STEP * auraCount(S, a);
    const ga = a.fg ? groupById(S, a.fg) : null;
    if (ga) m *= FORM_ATK[ga.type] / 100;
    if (a.su < SUP_MID) m *= 0.7; else if (a.su < SUP_OK) m *= 0.85;
    m *= Math.max(0.5, a.mo / 10000);
    let dm = 1;
    if (d.st === 0) dm /= 1 + AURA_STEP * auraCount(S, d);
    const gd = d.fg ? groupById(S, d.fg) : null;
    const c = attackDot(d, a, gd ? gd.dx : d.fx, gd ? gd.dy : d.fy);
    dm *= dirMult(c, gd ? gd.type : 0);
    if (d.rt > 0) dm *= 1.5;
    dmg = Math.floor(dmg * m * dm);
    if (dmg < 100) dmg = 100;
    d.hp -= dmg;
    // Tinh thần giảm khi bị đánh; dưới 20 điểm thì bỏ chạy 7 giây.
    const loss = (c < -0.5 ? 300 : c < 0.4 ? 100 : 40) * (s.rg > 0 ? 0.6 : 1) * (gd ? [0, 0.7, 1, 0.5][gd.type] : 1);
    d.mo = Math.max(0, d.mo - Math.floor(loss));
    if (d.mo < 2000 && d.rt <= 0 && d.hp > 0) { d.rt = 140; d.mo = 3800; }
  }
  function routStep(S, u) {
    const j = nearestEnemy(S, u, ACQUIRE);
    if (j < 0) return;
    const v = S.units[j];
    const dx = u.x - v.x, dy = u.y - v.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
    moveToward(S, u, u.x + Math.trunc(dx / L * 6000), u.y + Math.trunc(dy / L * 6000), Math.trunc(UNITS[u.k].sp * 5 / 4));
  }
  // Tinh thần hồi phục hoặc giảm theo tình hình quanh quân (theo HTML), đơn vị x100 mỗi giây, đổi sang mỗi tick.
  function updateMorale(S) {
    const R2 = 3500 * 3500;
    for (const u of S.units) {
      if (u.hp <= 0) continue;
      let ne = 0, na = 0;
      for (const v of S.units) {
        if (v === u || v.hp <= 0) continue;
        const dx = v.x - u.x, dy = v.y - u.y;
        if (dx * dx + dy * dy >= R2) continue;
        if (v.o === u.o) na++; else ne++;
      }
      const nc = nearestCity(S, u.x, u.y), ins = !!nc && nc.o === u.o;
      const lv = u.su < SUP_MID ? 2 : u.su < SUP_OK ? 1 : 0;
      let sum = 0;
      if (ne > na * 1.6 && ne > 2) sum -= ne / Math.max(1, na) > 1.5 ? 100 : 200;
      sum -= lv * 100;
      if (S.gold[u.o] <= 0) sum -= 200;
      if (u.eng) sum -= 800;
      if (sum === 0) sum = ins ? 400 : 200;
      u.mo = Math.max(0, Math.min(10000, u.mo + Math.trunc(sum / 20)));
    }
  }
  function nearestEnemy(S, u, range) {
    let best = -1, bd = range * range;
    for (let j = 0; j < S.units.length; j++) {
      const v = S.units[j];
      if (v.hp <= 0 || v.o === u.o) continue;
      const dx = v.x - u.x, dy = v.y - u.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }
  function nearestEnemyTower(S, u) {
    let best = null, bd = TOWER_REACH * TOWER_REACH;
    for (const t of S.towers) {
      if (t.o === u.o || t.hp <= 0) continue;
      const dx = t.x - u.x, dy = t.y - u.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function captureNearby(S, u) {
    for (const c of S.cities) {
      if (c.o === u.o) continue;
      const dx = c.x - u.x, dy = c.y - u.y;
      if (dx * dx + dy * dy < CAPTURE_R * CAPTURE_R) {
        c.hp -= Math.floor(UNITS[u.k].dmg * 3 / 20);
        if (c.hp <= 0) captureCity(S, c, u.o);
        return;
      }
    }
  }
  function combat(S) {
    const units = S.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.hp <= 0) continue;
      const s = UNITS[u.k];
      if (u.cd > 0) u.cd--;
      if (u.rt > 0) { u.rt--; u.eng = 0; routStep(S, u); continue; }
      let engaged = false;
      const j = nearestEnemy(S, u, ACQUIRE);
      if (j >= 0) {
        const v = units[j], reach = s.rg > 0 ? s.rg : MELEE;
        const dx = v.x - u.x, dy = v.y - u.y, d2 = dx * dx + dy * dy;
        if (d2 <= reach * reach) {
          engaged = true;
          if (u.cd === 0) { hit(S, u, v); u.cd = s.cd; }
        } else if (s.rg === 0 || (!u.ord && !u.fg)) {
          engaged = true;
          moveToward(S, u, v.x, v.y, s.sp);
        }
      }
      if (!engaged) {
        const t = nearestEnemyTower(S, u);
        if (t) {
          engaged = true;
          if (u.cd === 0) { t.hp -= Math.max(100, Math.floor(s.dmg * 50 / 100)); u.cd = s.cd; }
        }
      }
      u.eng = engaged ? 1 : 0;
      if (!engaged) {
        if (u.fg) {
          const tg = S._tgt.get(u.id);
          if (tg) {
            const dx = tg[0] - u.x, dy = tg[1] - u.y;
            if (dx * dx + dy * dy > 300 * 300) moveToward(S, u, tg[0], tg[1], s.sp);
          }
        } else if (u.ord) moveAlongOrder(S, u);
        captureNearby(S, u);
      }
    }
  }
  function updateCities(S) {
    for (const c of S.cities) {
      c.hp = Math.min(cityMax(c), c.hp + CITY_REGEN);
      let best = null, bd = CITY_SHOOT_R * CITY_SHOOT_R;
      for (const u of S.units) {
        if (u.hp <= 0 || u.o === c.o) continue;
        const dx = u.x - c.x, dy = u.y - c.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = u; }
      }
      if (best) best.hp -= Math.floor((c.cap ? 9 : 4) * 5 * (100 + 30 * c.wl) / 100);
    }
  }
  function updateTowers(S) {
    for (const t of S.towers) {
      if (t.hp <= 0) continue;
      t.hp = Math.min(TOWER_HP, t.hp + TOWER_REGEN);
      let best = null, bd = TOWER_RANGE * TOWER_RANGE;
      for (const u of S.units) {
        if (u.hp <= 0 || u.o === t.o) continue;
        const dx = u.x - t.x, dy = u.y - t.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = u; }
      }
      if (best) best.hp -= TOWER_DMG;
    }
  }
  // Tiếp tế: quân trong lãnh thổ mình và không giao chiến được hồi; quân ngoài lãnh thổ hoặc đang đánh thì hao dần.
  function updateSupply(S) {
    for (const u of S.units) {
      if (u.hp <= 0) continue;
      const nc = nearestCity(S, u.x, u.y);
      const ins = nc && nc.o === u.o;
      let d = ins && !u.eng ? 30 : -6;
      if (u.eng) d -= 48;
      u.su = Math.max(0, Math.min(SUP_MAX, u.su + d));
      if (u.su < SUP_LOW) u.hp -= 1;
      const tt = S.map.terr[cellOf(u.x, u.y)];
      if (!ins && (tt === 2 || tt === 3)) u.hp -= Math.floor(UNITS[u.k].hp * 12 / 20000);
    }
  }
  function captureCity(S, c, o) {
    const prev = c.o;
    takeCity(c, o);
    if (c.cap && prev >= 0 && prev !== o && c.home === prev) {
      const d2 = (a) => (a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y);
      const L = S.cities.filter(x => x !== c && x.o === prev).sort((a, b) => d2(a) - d2(b) || a.id - b.id);
      const k = Math.round(L.length * 0.4);
      for (let i = 0; i < k; i++) takeCity(L[i], o);
    }
  }
  function takeCity(c, o) {
    c.o = o; c.wl = 0; c.q = []; c.pr = 0;
    c.hp = Math.floor(cityMax(c) * 0.4);
  }

  // ---------- Kinh tế, sản xuất, AI, thắng thua ----------
  function economy(S) {
    const inc = new Array(S.players).fill(0), up = new Array(S.players).fill(0);
    for (const c of S.cities) if (c.o >= 0) inc[c.o] += c.home === c.o ? (c.cap ? 135 : 55) : 27;
    for (const u of S.units) if (u.hp > 0) up[u.o] += UNITS[u.k].up * 3;
    for (let p = 0; p < S.players; p++) S.gold[p] = Math.max(0, S.gold[p] + inc[p] - up[p]);
  }
  function production(S) {
    for (const c of S.cities) {
      if (c.o < 0 || c.q.length === 0) { c.pr = 0; continue; }
      c.pr++;
      const k = c.q[0];
      if (c.pr >= UNITS[k].tr) {
        c.pr = 0; c.q.shift();
        addUnit(S, c.o, k, c.x + S.rng.range(-1500, 1500), c.y + S.rng.range(-1500, 1500));
      }
    }
  }
  function aiTurn(S) {
    for (let p = 0; p < S.players; p++) {
      if (!S.alive[p] || !S.ai[p]) continue;
      for (const c of S.cities) if (c.o === p && c.q.length < 2) tryQueue(S, c, S.rng.next() % 5);
      const capIdx = S.cities.findIndex(c => c.o === p && c.cap);
      if (capIdx >= 0 && S.gold[p] > 300 * GOLD && S.rng.next() % 100 < 15) buildWall(S, p, capIdx);
      const home = S.cities.find(c => c.o === p && c.cap) || S.cities.find(c => c.o === p);
      if (!home) continue;
      let target = null, bd = INF * 4;
      for (const c of S.cities) {
        if (c.o === p) continue;
        const d = (c.x - home.x) * (c.x - home.x) + (c.y - home.y) * (c.y - home.y);
        if (d < bd) { bd = d; target = c; }
      }
      if (!target) continue;
      const dest = cellOf(target.x, target.y);
      for (const u of S.units) {
        if (u.o !== p || u.ord || u.hp <= 0 || u.fg) continue;
        if (S.rng.next() % 100 < 12) { u.dest = dest; u.ord = 1; }
      }
    }
  }
  function cleanup(S) {
    for (const d of S.units) {
      if (d.hp > 0) continue;
      S.lost[d.o] += UNITS[d.k].up * LOST_UNIT;
      for (const v of S.units) {
        if (v.hp <= 0 || v.o !== d.o) continue;
        const dx = v.x - d.x, dy = v.y - d.y;
        if (dx * dx + dy * dy < 3500 * 3500) v.mo = Math.max(0, v.mo - 500);
      }
    }
    S.units = S.units.filter(u => u.hp > 0);
    S.towers = S.towers.filter(t => t.hp > 0);
    for (let p = 0; p < S.players; p++) {
      if (S.alive[p] && !S.cities.some(c => c.o === p)) {
        S.alive[p] = false;
        for (const u of S.units) if (u.o === p) u.hp = 0;
      }
    }
    S.units = S.units.filter(u => u.hp > 0);
    const living = []; for (let p = 0; p < S.players; p++) if (S.alive[p]) living.push(p);
    if (!S.ended && (!S.alive[0] || living.length === 1)) {
      S.ended = true;
      S.winner = S.alive[0] ? 0 : (living.length === 1 ? living[0] : -1);
    }
  }

  // ---------- Lệnh và bước mô phỏng ----------
  function buildTower(S, p, cx, cy) {
    if (!(cx >= 0 && cy >= 0 && cx < W && cy < H)) return;
    if (S.gold[p] < TOWER_COST * GOLD || S.map.cost[cy * W + cx] <= 0) return;
    const x = cx * CELL + 500, y = cy * CELL + 500;
    const nc = nearestCity(S, x, y);
    if (!nc || nc.o !== p) return;
    const near = (a) => (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) < TOWER_SPACING * TOWER_SPACING;
    if (S.cities.some(near) || S.towers.some(near)) return;
    S.gold[p] -= TOWER_COST * GOLD;
    S.towers.push({ id: S.nextId++, o: p, x, y, hp: TOWER_HP });
  }
  function buildWall(S, p, city) {
    const c = S.cities[city];
    if (!c || c.o !== p || c.wl >= 3) return;
    const cost = (c.cap ? 120 : 60) * (c.wl + 1);
    if (S.gold[p] < cost * GOLD) return;
    S.gold[p] -= cost * GOLD;
    const before = cityMax(c);
    c.wl++;
    c.hp += cityMax(c) - before;
  }
  // Lệnh (chỉ số nguyên): move {ids,cx,cy} | produce {city,k} | stance {ids,st} | form {ids,type}
  //                      | disband {ids} | tower {cx,cy} | wall {city} | setAI {p,on} (chỉ server phát)
  function applyCommand(S, c) {
    if (!c) return;
    if (c.type === 'setAI') { if (c.p >= 0 && c.p < S.players) S.ai[c.p] = !!c.on; return; }
    if (c.p < 0 || c.p >= S.players || !S.alive[c.p] || S.ended) return;
    const p = c.p;
    if (c.type === 'move') {
      const cell = nearestPassable(S.map, c.cx, c.cy);
      if (cell < 0) return;
      const groups = new Set();
      for (const id of c.ids) {
        const u = unitById(S, id);
        if (!u || u.o !== p || u.hp <= 0) continue;
        if (u.fg) { const g = groupById(S, u.fg); if (g) groups.add(g); continue; }
        u.dest = cell; u.ord = 1;
      }
      for (const g of groups) { g.goal = cell; g.has = 1; }
    } else if (c.type === 'produce') {
      const city = S.cities[c.city];
      if (city && city.o === p) tryQueue(S, city, c.k);
    } else if (c.type === 'stance') {
      for (const id of c.ids) { const u = unitById(S, id); if (u && u.o === p && u.hp > 0) u.st = c.st ? 1 : 0; }
    } else if (c.type === 'form') {
      if (c.type === 'form' && c.ids && c.ids.length && (c.ftype === 1 || c.ftype === 2 || c.ftype === 3)) formUp(S, p, c.ids, c.ftype);
    } else if (c.type === 'disband') {
      for (const id of c.ids) { const u = unitById(S, id); if (u && u.o === p) leaveGroup(S, u); }
    } else if (c.type === 'tower') {
      buildTower(S, p, c.cx, c.cy);
    } else if (c.type === 'wall') {
      buildWall(S, p, c.city);
    }
  }
  function step(S, cmds) {
    if (S.ended) return S;
    S.tick++;
    for (const c of cmds) applyCommand(S, c);
    economy(S);
    production(S);
    if (S.tick % 100 === 0) aiTurn(S);
    updateGroups(S);
    combat(S);
    updateMorale(S);
    updateCities(S);
    updateTowers(S);
    updateSupply(S);
    for (let p = 0; p < S.players; p++) {
      const pc = S.cities.filter(c => c.o === p).length;
      S.lost[p] = Math.max(0, S.lost[p] - (15 + 2 * pc));
    }
    cleanup(S);
    return S;
  }

  // Hash FNV-1a của toàn bộ trạng thái để so sánh đồng bộ.
  function hash(S) {
    let h = 0x811c9dc5;
    const add = (v) => { h ^= (v | 0); h = Math.imul(h, 16777619); };
    add(S.tick);
    for (const g of S.gold) add(g);
    for (const l of S.lost) add(l);
    for (const a of S.ai) add(a ? 1 : 0);
    for (const p of S.alive) add(p ? 1 : 0);
    for (const c of S.cities) { add(c.o); add(c.hp); add(c.wl); add(c.q.length); add(c.pr); }
    for (const t of S.towers) { add(t.o); add(t.x); add(t.y); add(t.hp); }
    for (const g of S.groups) { add(g.id); add(g.cx); add(g.cy); add(g.dx); add(g.dy); add(g.has); add(g.goal); for (const id of g.mem) add(id); }
    for (const u of S.units) {
      add(u.id); add(u.o); add(u.k); add(u.x); add(u.y); add(u.hp); add(u.cd); add(u.ord); add(u.dest);
      add(u.st); add(u.su); add(u.fg); add(u.eng); add(u.fx); add(u.fy); add(u.mo); add(u.rt);
    }
    return h >>> 0;
  }

  const api = {
    CELL, TPS, GOLD, W, H, UNITS, Rng, genMap, createState, step, hash, applyCommand,
    popUsed, popCap, auraCount, nearestCity, cityMax, formSlots, addUnit, addCity, unitById, groupById, buildTower, buildWall,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChienTruongCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
