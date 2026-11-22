'use strict';
// Máy chủ ghép phòng và chuyển lệnh lockstep. Server KHÔNG mô phỏng trận; chỉ gom lệnh theo tick.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const TICK_MS = Number(process.env.TICK_MS) || 50;   // thời lượng một tick (ms)
const DELAY = 3;                                     // tick đệm đầu vào
const WAIT_MS = Number(process.env.WAIT_MS) || 1500; // chờ tối đa trước khi coi người chơi đã rớt
const MAX_HUMANS = 5;
const MAX_AHEAD = 60;                                // bỏ lệnh gửi quá xa trong tương lai
const ROOT = __dirname;
const FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/client.js': ['public/client.js', 'application/javascript; charset=utf-8'],
  '/core.js': ['core.js', 'application/javascript; charset=utf-8'],
  '/lockstep.js': ['lockstep.js', 'application/javascript; charset=utf-8'],
};

const rooms = new Map();
let nextPid = 1;

function httpHandler(req, res) {
  const f = FILES[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, f[0]), (err, data) => {
    if (err) { res.writeHead(500); res.end('Server error'); return; }
    res.writeHead(200, { 'Content-Type': f[1] });
    res.end(data);
  });
}

const server = http.createServer(httpHandler);
const wss = new WebSocketServer({ server });

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function findSlot(room, pid) { return room.slots.find(s => s.pid === pid); }
function sendRoom(room, error) {
  for (const s of room.slots) {
    send(s.ws, {
      t: 'room', code: room.code, host: room.host, you: s.pid, started: room.started,
      players: room.slots.map(x => x.name), error: error || null, token: s.token,
    });
  }
}
function makeToken() { let t = ''; for (let i = 0; i < 24; i++) t += Math.floor(Math.random() * 36).toString(36); return t; }
function makeCode() {
  const L = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += L[Math.floor(Math.random() * L.length)];
  return rooms.has(c) ? makeCode() : c;
}
function cleanName(n) { return String(n || 'Người chơi').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Người chơi'; }

// Chỉ nhận lệnh hợp lệ; server gắn người chơi (p) theo chỗ của người gửi, không tin giá trị từ client.
function cleanCmds(list, p) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list.slice(0, 50)) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'move' && Array.isArray(c.ids) && Number.isInteger(c.cx) && Number.isInteger(c.cy)) {
      out.push({ p, type: 'move', ids: c.ids.slice(0, 200).filter(Number.isInteger), cx: c.cx, cy: c.cy });
    } else if (c.type === 'produce' && Number.isInteger(c.city) && Number.isInteger(c.k)) {
      out.push({ p, type: 'produce', city: c.city, k: c.k });
    } else if (c.type === 'stance' && Array.isArray(c.ids) && (c.st === 0 || c.st === 1)) {
      out.push({ p, type: 'stance', ids: c.ids.slice(0, 200).filter(Number.isInteger), st: c.st });
    } else if (c.type === 'form' && Array.isArray(c.ids) && [1, 2, 3].includes(c.ftype)) {
      out.push({ p, type: 'form', ids: c.ids.slice(0, 200).filter(Number.isInteger), ftype: c.ftype });
    } else if (c.type === 'disband' && Array.isArray(c.ids)) {
      out.push({ p, type: 'disband', ids: c.ids.slice(0, 200).filter(Number.isInteger) });
    } else if (c.type === 'tower' && Number.isInteger(c.cx) && Number.isInteger(c.cy)) {
      out.push({ p, type: 'tower', cx: c.cx, cy: c.cy });
    } else if (c.type === 'wall' && Number.isInteger(c.city)) {
      out.push({ p, type: 'wall', city: c.city });
    }
  }
  return out;
}

function handle(ws, m) {
  switch (m.t) {
    case 'create': return createRoom(ws, m.name);
    case 'join': return joinRoom(ws, m.code, m.name);
    case 'start': return startRoom(ws);
    case 'cmd': return onCmd(ws, m);
    case 'rejoin': return rejoin(ws, m.code, m.token);
    case 'hash': return onHash(ws, m);
  }
}

function createRoom(ws, name) {
  if (ws.room) return send(ws, { t: 'room', error: 'Bạn đang ở trong một phòng' });
  const code = makeCode();
  const room = { code, host: ws.pid, slots: [], started: false, frame: 1, buffers: new Map(), hashes: new Map(), waitTick: 0, waitSince: 0 };
  room.slots.push({ pid: ws.pid, name: cleanName(name), ws, ai: false, done: false, doneTick: 0, index: 0, token: makeToken(), connected: true });
  rooms.set(code, room);
  ws.room = room;
  sendRoom(room);
}

function joinRoom(ws, code, name) {
  if (ws.room) return send(ws, { t: 'room', error: 'Bạn đang ở trong một phòng' });
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return send(ws, { t: 'room', error: 'Không tìm thấy phòng' });
  if (room.started) return send(ws, { t: 'room', error: 'Phòng đã bắt đầu' });
  if (room.slots.length >= MAX_HUMANS) return send(ws, { t: 'room', error: 'Phòng đã đầy' });
  room.slots.push({ pid: ws.pid, name: cleanName(name), ws, ai: false, done: false, doneTick: 0, index: room.slots.length, token: makeToken(), connected: true });
  ws.room = room;
  sendRoom(room);
}

function startRoom(ws) {
  const room = ws.room;
  if (!room || room.host !== ws.pid || room.started) return;
  room.started = true; room.frame = 1; room.waitTick = 0; room.history = [];
  const humans = room.slots.length;
  const players = Math.max(2, humans);
  const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  const ai = Array.from({ length: players }, (_, p) => p >= humans);
  room.init = { seed, players, ai };
  room.slots.forEach((s, i) => { s.index = i; s.ai = false; s.done = false; });
  for (const s of room.slots) {
    send(s.ws, { t: 'start', seed, players, ai, slot: s.index, delay: DELAY, tickMs: TICK_MS });
  }
}

function onCmd(ws, m) {
  const room = ws.room;
  if (!room || !room.started) return;
  const slot = findSlot(room, ws.pid);
  if (!slot || slot.ai || !Number.isInteger(m.tick)) return;
  if (m.tick < room.frame || m.tick > room.frame + MAX_AHEAD) return;
  let buf = room.buffers.get(m.tick);
  if (!buf) { buf = new Map(); room.buffers.set(m.tick, buf); }
  buf.set(slot.index, cleanCmds(m.cmds, slot.index));
  if (m.done === true && !slot.done) { slot.done = true; slot.doneTick = m.tick; }
}

function onHash(ws, m) {
  const room = ws.room;
  if (!room || !room.started || !Number.isInteger(m.tick)) return;
  const slot = findSlot(room, ws.pid);
  if (!slot) return;
  let map = room.hashes.get(m.tick);
  if (!map) { map = new Map(); room.hashes.set(m.tick, map); }
  map.set(slot.index, m.h);
  const humans = room.slots.filter(s => !s.ai);
  if (humans.length && humans.every(s => map.has(s.index))) {
    const values = new Set(humans.map(s => map.get(s.index)));
    if (values.size > 1) {
      for (const s of room.slots) send(s.ws, { t: 'desync', tick: m.tick });
    }
    room.hashes.delete(m.tick);
  }
}

// Phát một bundle mỗi khi tick kế tiếp đã đủ lệnh (hoặc đã hết thời gian chờ).
function pump(room) {
  for (let guard = 0; room.started && guard < 50; guard++) {
    const T = room.frame;
    const buf = room.buffers.get(T) || new Map();
    const live = room.slots.filter(s => !s.ai && !(s.done && T > s.doneTick));
    if (live.length === 0) { finish(room); return; }
    const missing = live.filter(s => !buf.has(s.index));
    const now = Date.now();
    const forced = [];
    if (missing.length) {
      if (room.waitTick !== T) { room.waitTick = T; room.waitSince = now; }
      if (now - room.waitSince < WAIT_MS) return;
      for (const s of missing) { s.ai = true; forced.push(s.index); }
    }
    const cmds = forced.map(p => ({ p, type: 'setAI', on: true }));
    for (const s of room.slots) {
      if (forced.includes(s.index)) continue;
      const list = buf.get(s.index);
      if (list) for (const c of list) cmds.push(c);
    }
    room.buffers.delete(T);
    room.frame++; room.waitTick = 0;
    room.history.push({ tick: T, cmds });
    for (const s of room.slots) send(s.ws, { t: 'bundle', tick: T, cmds });
  }
}

// Kết nối lại: gắn lại socket mới vào đúng chỗ bằng token, gửi lịch sử bundle để máy tự tái tạo trận.
function rejoin(ws, code, token) {
  if (ws.room) return;
  const room = rooms.get(String(code || '').toUpperCase());
  const slot = room && room.slots.find(s => s.token === token);
  if (!slot) return send(ws, { t: 'room', error: 'Không thể kết nối lại' });
  if (slot.ws && slot.ws !== ws) { slot.ws.room = null; }
  slot.ws = ws; slot.pid = ws.pid; slot.connected = true; ws.room = room;
  if (!room.started) return sendRoom(room);
  send(ws, { t: 'resume', slot: slot.index, seed: room.init.seed, players: room.init.players, ai: room.init.ai,
    delay: DELAY, tickMs: TICK_MS, frame: room.frame, history: room.history });
}

function finish(room) {
  room.started = false;
  for (const s of room.slots) { send(s.ws, { t: 'over' }); if (s.ws) s.ws.room = null; }
  rooms.delete(room.code);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const slot = findSlot(room, ws.pid);
  if (!room.started) {
    room.slots = room.slots.filter(s => s !== slot);
    if (room.slots.length === 0) rooms.delete(room.code);
    else {
      if (room.host === ws.pid) room.host = room.slots[0].pid;
      sendRoom(room);
    }
  } else if (slot) {
    slot.ws = null; // sẽ bị AI thay sau WAIT_MS nếu không gửi lệnh
  }
}

wss.on('connection', (ws) => {
  ws.pid = nextPid++;
  ws.room = null;
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    handle(ws, m);
  });
  ws.on('close', () => leave(ws));
});

const pumpTimer = setInterval(() => { for (const r of rooms.values()) { if (!r.started) continue; try { pump(r); } catch (e) { console.error('lỗi phòng', r.code, e); } } }, 10);
pumpTimer.unref && pumpTimer.unref();

module.exports = { server, rooms, DELAY };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Chiến Trường online: http://localhost:${port}`));
}
