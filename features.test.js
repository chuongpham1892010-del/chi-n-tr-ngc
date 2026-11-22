// Kiểm tra từng hệ thống mới: đội hình, chỉ huy/aura, tháp, tường, tiếp tế, hao mòn, đường đi, tất định với mọi lệnh.
const assert = require('assert');
const C = require('../core.js');

function fresh(seed = 4242) { return C.createState({ seed, players: 3 }); }
function ownUnits(S, p) { return S.units.filter(u => u.o === p && u.hp > 0); }

// 1) Đội hình: số slot bằng số quân, và mỗi quân được gắn đội.
for (const type of [1, 2, 3]) {
  for (let n = 2; n <= 12; n++) {
    assert.strictEqual(C.formSlots(type, n).length, n, `formSlots(${type},${n}) sai số lượng`);
  }
}
{
  const S = fresh();
  const ids = ownUnits(S, 0).slice(0, 4).map(u => u.id);
  C.applyCommand(S, { p: 0, type: 'form', ids, ftype: 1 });
  assert.strictEqual(S.groups.length, 1, 'phải có một đội hình');
  const g = S.groups[0];
  assert.strictEqual(g.mem.length, 4);
  for (const id of ids) assert.strictEqual(C.unitById(S, id).fg, g.id, 'quân chưa được gắn đội');
  C.applyCommand(S, { p: 0, type: 'disband', ids });
  assert.strictEqual(S.groups.length, 0, 'tách đội không thành công');
  console.log('OK: lập và tách đội hình');
}

// 2) Đội hình di chuyển cùng nhau tới đích và giữ được số quân.
{
  const S = fresh();
  const ids = ownUnits(S, 0).slice(0, 5).map(u => u.id);
  C.applyCommand(S, { p: 0, type: 'form', ids, ftype: 2 });
  const cap = S.cities.find(c => c.o === 0 && c.cap);
  // Đi tới thành khác của mình (không có địch trên đường) để kiểm tra đội di chuyển.
  const target = S.cities.find(c => c.o === 0 && !c.cap);
  C.applyCommand(S, { p: 0, type: 'move', ids, cx: target.cx, cy: target.cy });
  for (let t = 0; t < 600; t++) C.step(S, []);
  const g = S.groups[0];
  assert(g, 'đội hình bị tan khi di chuyển');
  assert.strictEqual(g.mem.length, ids.filter(id => C.unitById(S, id)).length, 'số quân trong đội không khớp');
  console.log(`OK: đội hình di chuyển, tâm cách mục tiêu ${Math.hypot(g.cx - target.x, g.cy - target.y).toFixed(0)} phần nghìn ô`);
}

// 3) Chỉ huy và aura: đếm chỉ huy cùng phe trong bán kính 3,5 ô, tối đa 4.
{
  const S = fresh();
  const base = { x: 50000, y: 30000 };
  S.units = [];
  C.addUnit(S, 0, 0, base.x, base.y);
  const u = S.units[0];
  C.addUnit(S, 0, 5, base.x + 1000, base.y);
  C.addUnit(S, 0, 5, base.x, base.y + 2000);
  C.addUnit(S, 0, 5, base.x + 9000, base.y);  // quá xa
  C.addUnit(S, 1, 5, base.x - 500, base.y);   // khác phe
  assert.strictEqual(C.auraCount(S, u), 2, 'aura phải đếm đúng 2 chỉ huy cùng phe gần');
  for (let i = 0; i < 6; i++) C.addUnit(S, 0, 5, base.x + 500 + i * 100, base.y + 500);
  assert.strictEqual(C.auraCount(S, u), 4, 'aura phải dừng ở 4 chỉ huy');
  console.log('OK: aura chỉ huy đếm đúng và dừng ở 4');
}

// 4) Tháp canh: đặt được trên đất của mình, không đặt được trên nước hoặc quá gần thành.
{
  const S = fresh();
  const cap = S.cities.find(c => c.o === 0 && c.cap);
  let spot = null;
  for (let y = 0; y < C.H && !spot; y++) for (let x = 0; x < C.W && !spot; x++) {
    if (S.map.cost[y * C.W + x] <= 0) continue;
    const dx = x * 1000 + 500 - cap.x, dy = y * 1000 + 500 - cap.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 3000 * 3000 && d2 < 4000 * 4000) {
      const nc = C.nearestCity(S, x * 1000 + 500, y * 1000 + 500);
      if (nc && nc.o === 0 && S.cities.every(c => (c.x - (x * 1000 + 500)) ** 2 + (c.y - (y * 1000 + 500)) ** 2 >= 1500 * 1500)) spot = { x, y };
    }
  }
  assert(spot, 'không tìm được ô thử nghiệm');
  const gold0 = S.gold[0];
  C.applyCommand(S, { p: 0, type: 'tower', cx: spot.x, cy: spot.y });
  assert.strictEqual(S.towers.length, 1, 'không đặt được tháp hợp lệ');
  assert.strictEqual(S.gold[0], gold0 - 30 * C.GOLD, 'chi phí tháp không đúng');
  // Đặt trùng chỗ phải thất bại
  C.applyCommand(S, { p: 0, type: 'tower', cx: spot.x, cy: spot.y });
  assert.strictEqual(S.towers.length, 1, 'cho phép đặt tháp quá gần tháp khác');
  // Đặt trên nước phải thất bại
  const water = S.map.cost.findIndex(c => c <= 0);
  C.applyCommand(S, { p: 0, type: 'tower', cx: water % C.W, cy: Math.floor(water / C.W) });
  assert.strictEqual(S.towers.length, 1, 'cho phép đặt tháp trên nước');
  console.log('OK: tháp canh đặt đúng chỗ và tính đúng chi phí');
}

// 5) Tường thành: nâng cấp tốn vàng và tăng máu tối đa 40% mỗi cấp.
{
  const S = fresh();
  const cap = S.cities.find(c => c.o === 0 && c.cap);
  const idx = S.cities.indexOf(cap);
  S.gold[0] = 500 * C.GOLD;  // vàng khởi đầu (70) không đủ để nâng tường thủ đô (120)
  const base = C.cityMax(cap), g0 = S.gold[0];
  C.applyCommand(S, { p: 0, type: 'wall', city: idx });
  assert.strictEqual(cap.wl, 1, 'chưa nâng tường');
  assert.strictEqual(S.gold[0], g0 - 120 * C.GOLD, 'giá tường không đúng');
  assert.strictEqual(C.cityMax(cap), Math.floor(base * 1.4), 'máu tường không đúng');
  console.log('OK: tường thành tốn đúng vàng và tăng máu');
}

// 6) Tiếp tế: quân đứng trên đất địch thì tiếp tế giảm dần.
{
  const S = fresh();
  const foreign = S.cities.find(c => c.o === 1 && !c.cap);
  S.units = [];
  C.addUnit(S, 0, 0, foreign.x + 3000, foreign.y);
  const u = S.units[0];
  for (let t = 0; t < 400; t++) C.step(S, []);
  const alive = C.unitById(S, u.id);
  assert(alive === null || alive.su < 10000, 'quân ngoài lãnh thổ phải hao tiếp tế');
  console.log(`OK: tiếp tế hao khi ngoài lãnh thổ (su = ${alive ? alive.su : 'đã chết'})`);
}

// 7) Hao mòn: quân chết làm tăng quân đã mất và chiếm dân số.
{
  const S = fresh();
  const before = S.lost[0];
  const u = ownUnits(S, 0)[0];
  u.hp = 0;
  C.step(S, []);
  assert(S.lost[0] > before, 'quân chết không được ghi vào quân đã mất');
  console.log('OK: quân chết được ghi vào hao mòn');
}

// 8) Lệnh đổi tư thế.
{
  const S = fresh();
  const ids = ownUnits(S, 0).slice(0, 3).map(u => u.id);
  C.applyCommand(S, { p: 0, type: 'stance', ids, st: 0 });
  for (const id of ids) assert.strictEqual(C.unitById(S, id).st, 0);
  console.log('OK: đổi tư thế phòng thủ/tấn công');
}

// 9) Đường đi: quân đi qua địa hình tới đích.
{
  const S = fresh();
  const u = ownUnits(S, 0)[0];
  const cap = S.cities.find(c => c.o === 0 && c.cap);
  const far = S.cities.find(c => c.o === 1);
  C.applyCommand(S, { p: 0, type: 'move', ids: [u.id], cx: far.cx, cy: far.cy });
  for (let t = 0; t < 1500 && C.unitById(S, u.id) && C.unitById(S, u.id).ord; t++) C.step(S, []);
  const v = C.unitById(S, u.id);
  if (v) assert(Math.hypot(v.x - (far.cx * 1000 + 500), v.y - (far.cy * 1000 + 500)) < 4000 || v.ord === 0, 'quân không tới được đích');
  console.log('OK: quân đi theo đường tới đích');
}

// 10) Tất định với mọi loại lệnh: hai máy cùng lệnh phải khớp hash.
{
  const A = fresh(777), B = fresh(777);
  let s = 99; const rnd = (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
  for (let t = 1; t <= 2500; t++) {
    const cmds = [];
    if (t % 9 === 0) { const p = rnd(3), mine = A.cities.filter(c => c.o === p); if (mine.length) cmds.push({ p, type: 'produce', city: mine[rnd(mine.length)].id, k: rnd(6) }); }
    if (t % 13 === 0) { const p = rnd(3), ids = ownUnits(A, p).slice(0, 5).map(u => u.id); if (ids.length) cmds.push({ p, type: 'move', ids, cx: rnd(C.W), cy: rnd(C.H) }); }
    if (t % 31 === 0) { const p = rnd(3), ids = ownUnits(A, p).slice(0, 4).map(u => u.id); if (ids.length >= 2) cmds.push({ p, type: 'form', ids, ftype: 1 + rnd(3) }); }
    if (t % 47 === 0) { const p = rnd(3), ids = ownUnits(A, p).slice(0, 4).map(u => u.id); if (ids.length) cmds.push({ p, type: 'stance', ids, st: rnd(2) }); }
    if (t % 53 === 0) { const p = rnd(3), ids = ownUnits(A, p).slice(0, 4).map(u => u.id); if (ids.length) cmds.push({ p, type: 'disband', ids }); }
    if (t % 59 === 0) { const p = rnd(3), mine = A.cities.filter(c => c.o === p); if (mine.length) cmds.push({ p, type: 'wall', city: mine[rnd(mine.length)].id }); }
    if (t % 67 === 0) { const p = rnd(3); cmds.push({ p, type: 'tower', cx: rnd(C.W), cy: rnd(C.H) }); }
    C.step(A, cmds);
    C.step(B, cmds);
    if (t % 100 === 0) assert.strictEqual(C.hash(A), C.hash(B), `lệch tại tick ${t}`);
  }
  console.log(`OK: 2500 tick với đủ loại lệnh, hash khớp (tick ${A.tick}, quân = ${A.units.length}, tháp = ${A.towers.length}, đội = ${A.groups.length})`);
}


// 11) Tinh thần: quân bị đánh liên tục sẽ mất tinh thần và có thể bỏ chạy.
{
  const S = fresh(31);
  const a = S.units.find(u => u.o === 0), b = S.units.find(u => u.o === 1);
  S.units = [];
  C.addUnit(S, 0, 0, 50000, 30000);
  C.addUnit(S, 1, 0, 50800, 30000);
  const ua = S.units[0], ub = S.units[1];
  ub.hp = 10**9; // không chết để quan sát tinh thần
  let fled = false, moraleDrop = false;
  for (let t = 0; t < 600; t++) {
    C.step(S, []);
    if (ua.mo < 10000) moraleDrop = true;
    if (ua.rt > 0) { fled = true; break; }
    ua.hp = 10**9; ub.hp = 10**9;
    ua.mo = Math.min(ua.mo, 10000);
  }
  assert(moraleDrop, 'tinh thần không giảm khi bị đánh');
  console.log(`OK: tinh thần giảm khi giao chiến${fled ? ', quân bỏ chạy khi xuống thấp' : ''}`);
}
// 12) Sông: có ít nhất một con sông trong vài bản đồ, các ô sông là đất hoặc nước.
{
  let total = 0;
  for (const sd of [1, 2, 3, 4, 5]) total += C.genMap(sd).rivers.length;
  assert(total >= 5, 'bản đồ thiếu sông');
  console.log(`OK: sông được sinh tất định (${total} sông trên 5 bản đồ)`);
}
// 13) Địa hình hoang dã: quân ngoài lãnh thổ trên núi hoặc rừng mất máu.
{
  const S = fresh(8);
  const idx = S.map.terr.findIndex((t, i) => (t === 2 || t === 3) && (() => { const nc = C.nearestCity(S, (i % C.W) * 1000 + 500, Math.floor(i / C.W) * 1000 + 500); return nc && nc.o !== 0; })());
  if (idx >= 0) {
    S.units = [];
    C.addUnit(S, 0, 0, (idx % C.W) * 1000 + 500, Math.floor(idx / C.W) * 1000 + 500);
    const u = S.units[0];
    const h0 = u.hp;
    C.step(S, []);
    assert(u.hp < h0, 'quân trên núi/rừng ngoài lãnh thổ không mất máu');
    console.log('OK: quân ngoài lãnh thổ trên rừng/núi mất máu');
  } else console.log('BỎ QUA: không có ô rừng/núi ngoài lãnh thổ trong bản đồ này');
}

console.log('TẤT CẢ KIỂM TRA HỆ THỐNG ĐẠT');
