// Kiểm tra tích hợp qua WebSocket thật: đồng bộ 3 máy, người rớt vĩnh viễn bị AI thay, người rớt rồi kết nối lại.
process.env.TICK_MS = '5';
process.env.WAIT_MS = '600';
const assert = require('assert');
const WebSocket = require('ws');
const C = require('../core.js');
const Lockstep = require('../lockstep.js');
const srv = require('../server.js');

function testRng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0); }

// Một máy khách: giữ lockstep, ghi hash theo tick, xử lý start/resume/bundle.
function attach(c, port, log) {
  c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
  c.send = (m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
  c.ws.on('open', () => {
    if (c.token && c.code && c.wantRejoin) c.send({ t: 'rejoin', code: c.code, token: c.token });
  });
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'room') {
      if (m.error) log.push(`${c.name}: lỗi ${m.error}`);
      else { c.room = m; c.token = m.token; c.code = m.code; }
    } else if (m.t === 'start' || m.t === 'resume') {
      if (c.lock) c.lock.stop();
      c.slot = m.slot;
      c.lock = new Lockstep({
        core: C, send: c.send, tickMs: m.tickMs,
        onStep: (S) => { if (S.tick % 50 === 0) c.hashes.set(S.tick, C.hash(S)); },
      });
      c.lock.start(m);
      c.resumed = m.t === 'resume';
    } else if (m.t === 'bundle') { if (c.lock) c.lock.onBundle(m); }
    else if (m.t === 'desync') { c.desync = true; log.push(`${c.name}: DESYNC tại ${m.tick}`); }
  });
  return c;
}
function makeClient(port, name, log) {
  return attach({ name, ws: null, lock: null, hashes: new Map(), desync: false, room: null, slot: -1, tr: testRng(name.length * 7919), token: null, code: null, resumed: false }, port, log);
}

function randomCommands(c) {
  if (!c.lock || !c.lock.S || c.lock.S.ended) return;
  const S = c.lock.S, tr = c.tr;
  if (tr() % 3 === 0) {
    const mine = S.cities.filter(x => x.o === c.slot);
    if (mine.length) c.lock.command({ type: 'produce', city: mine[tr() % mine.length].id, k: tr() % 5 });
  }
  if (tr() % 4 === 0) {
    const ids = S.units.filter(u => u.o === c.slot).slice(0, 5).map(u => u.id);
    if (ids.length) c.lock.command({ type: 'move', ids, cx: tr() % C.W, cy: tr() % C.H });
  }
  if (tr() % 11 === 0) {
    const ids = S.units.filter(u => u.o === c.slot).slice(0, 3).map(u => u.id);
    if (ids.length >= 2) c.lock.command({ type: 'form', ids, ftype: 1 + (tr() % 3) });
  }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('hết thời gian chờ: ' + what);
    await wait(10);
  }
};

srv.server.listen(0, async () => {
  const port = srv.server.address().port;
  const log = [];
  const clients = [];
  let failed = null;
  let gen = null;
  try {
    const host = makeClient(port, 'An', log); clients.push(host);
    await until(() => host.ws.readyState === 1, 3000, 'kết nối máy chủ');
    host.send({ t: 'create', name: 'An' });
    await until(() => host.code, 3000, 'mã phòng');
    const others = ['Bình', 'Chi'].map(n => makeClient(port, n, log));
    clients.push(...others);
    await until(() => others.every(o => o.ws.readyState === 1), 3000, 'kết nối 2 máy còn lại');
    for (const o of others) o.send({ t: 'join', code: host.code, name: o.name });
    await until(() => others.every(o => o.room && o.room.players && o.room.players.length === 3), 3000, '3 người trong phòng');
    host.send({ t: 'start' });
    await until(() => clients.every(c => c.lock && c.lock.S), 3000, 'bắt đầu trận');

    gen = setInterval(() => clients.forEach(c => { if (c.ws.readyState === 1) randomCommands(c); }), 40);

    // Giai đoạn 1: ba máy cùng chơi.
    await until(() => clients.every(c => c.lock.S.tick >= 400), 60000, '400 tick');

    // Giai đoạn 2: Chi rớt vĩnh viễn; trận tiếp tục và Chi được AI thay.
    clients[2].ws.close(); clients[2].lock.stop(); clients[2].dropped = true;
    await until(() => clients[0].lock.S.tick >= 800 && clients[1].lock.S.tick >= 800, 60000, '800 tick');

    // Giai đoạn 3: Bình rớt rồi kết nối lại bằng token; phải được tái tạo trận và tiếp tục điều khiển.
    const bTick = clients[1].lock.S.tick;
    clients[1].ws.close(); clients[1].lock.stop();
    await wait(150);
    clients[1].wantRejoin = true;
    attach(clients[1], port, log);
    await until(() => clients[1].resumed && clients[1].lock && clients[1].lock.S.tick >= bTick, 30000, 'Bình kết nối lại và bắt kịp');
    await until(() => clients[0].lock.S.tick >= 1200 && clients[1].lock.S.tick >= 1200, 60000, '1200 tick');
    clearInterval(gen); gen = null;

    assert(clients.every(c => !c.desync), 'có lệch đồng bộ: ' + log.join('; '));
    const live = [clients[0], clients[1]];
    const common = [...live[0].hashes.keys()].filter(t => live.every(c => c.hashes.has(t)));
    assert(common.length > 20, 'quá ít mốc hash để so');
    for (const t of common) {
      const hs = live.map(c => c.hashes.get(t));
      assert(hs.every(h => h === hs[0]), `hash lệch tại tick ${t}`);
    }
    const ai = live[0].lock.S.ai;
    assert(ai[2] === true, 'người rớt vĩnh viễn phải được AI thay');
    assert(ai[1] === false, 'người kết nối lại không được giữ quyền điều khiển');
    console.log(`OK: 3 máy đồng bộ qua ${common.length} mốc hash, có cả rớt vĩnh viễn và kết nối lại`);
    console.log(`OK: Chi (rớt vĩnh viễn) được AI thay, Bình kết nối lại vẫn điều khiển (ai = [${ai.join(', ')}])`);
    const S = live[0].lock.S;
    console.log(`Tick ${S.tick}: thành = [${[0, 1, 2].map(p => S.cities.filter(c => c.o === p).length).join(', ')}], quân = ${S.units.length}, đội = ${S.groups.length}, tháp = ${S.towers.length}`);
  } catch (e) {
    failed = e;
  } finally {
    if (gen) clearInterval(gen);
    for (const c of clients) { try { c.ws.close(); } catch (e) {} }
    await wait(100);
    srv.server.close();
    if (failed) { console.error('THẤT BẠI:', failed.message); process.exit(1); }
    console.log('TẤT CẢ KIỂM TRA TÍCH HỢP ĐỀU ĐẠT');
    process.exit(0);
  }
});
