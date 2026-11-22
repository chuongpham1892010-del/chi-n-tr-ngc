// Kiểm tra tất định: hai mô phỏng cùng seed và cùng lệnh phải có cùng hash ở mọi thời điểm.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../core.js');

// 1) Không được dùng nguồn ngẫu nhiên hoặc thời gian thực trong lõi.
const src = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8').replace(/\/\/.*$/gm, '');
for (const bad of ['Math.random', 'Date.', 'performance.', 'Math.sin', 'Math.cos', 'Math.pow', 'Math.exp', 'Math.log']) {
  assert(!src.includes(bad), `core.js dùng API không tất định: ${bad}`);
}

// Sinh lệnh từ RNG riêng của bài test (không liên quan đến lõi).
function testRng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0); }

function makeCommands(S, tick, tr) {
  const out = [];
  const pick = (n) => tr() % n;
  if (tick % 40 === 0) {
    const p = pick(S.players);
    const owned = S.cities.filter(c => c.o === p);
    if (owned.length) out.push({ p, type: 'produce', city: owned[pick(owned.length)].id, k: pick(5) });
  }
  if (tick % 60 === 0) {
    const p = pick(S.players);
    const ids = S.units.filter(u => u.o === p && u.hp > 0).slice(0, 6).map(u => u.id);
    if (ids.length) out.push({ p, type: 'move', ids, cx: pick(C.W), cy: pick(C.H) });
  }
  return out;
}

function run(seed, players, ticks, mutate) {
  const A = C.createState({ seed, players });
  const B = C.createState({ seed, players });
  const tr = testRng(seed ^ 0xabc);
  const hashes = [];
  let firstDiff = -1;
  for (let t = 1; t <= ticks; t++) {
    const cmds = makeCommands(A, t, tr);
    C.step(A, cmds);
    // Máy thứ hai nhận cùng lệnh; cờ mutate dùng để kiểm tra rằng sai một lệnh thì hash phải khác.
    const cmdsB = mutate ? cmds.filter((_, i) => i !== 0 || t % 40 !== 0) : cmds;
    C.step(B, cmdsB);
    if (t % 50 === 0) {
      const ha = C.hash(A), hb = C.hash(B);
      hashes.push(ha);
      if (ha !== hb && firstDiff < 0) firstDiff = t;
    }
  }
  return { A, B, hashes, firstDiff };
}

// 2) Hai máy cùng lệnh phải đồng bộ tuyệt đối.
const r1 = run(12345, 3, 4000, false);
assert.strictEqual(r1.firstDiff, -1, `lệch đồng bộ tại tick ${r1.firstDiff}`);
console.log('OK: 4000 tick, 3 người chơi, hash khớp ở mọi mốc 50 tick');

// 3) Kiểm tra độ nhạy: thiếu một lệnh phải làm hash khác (nếu không, bài test vô nghĩa).
const r2 = run(12345, 3, 4000, true);
assert.notStrictEqual(r2.firstDiff, -1, 'thiếu lệnh nhưng hash vẫn khớp: kiểm tra không có tác dụng');
console.log(`OK: thiếu một lệnh làm lệch tại tick ${r2.firstDiff}`);

// 4) Seed khác phải cho bản đồ khác.
assert.notStrictEqual(C.hash(C.createState({ seed: 1, players: 3 })), C.hash(C.createState({ seed: 2, players: 3 })));
console.log('OK: seed khác cho trạng thái khác');

// 5) Chạy lại cùng seed cho cùng hash cuối (không phụ thuộc vào thứ tự hay thời điểm chạy).
const finalA = C.hash(r1.A);
const r3 = run(12345, 3, 4000, false);
assert.strictEqual(C.hash(r3.A), finalA, 'chạy lại cho hash khác');
console.log(`OK: chạy lại cho cùng hash cuối ${finalA}`);

// 6) Tóm tắt trận để kiểm tra luật chơi có hoạt động.
const S = r1.A;
const cnt = (p) => S.cities.filter(c => c.o === p).length;
console.log(`Tick ${S.tick}: thành theo người chơi = [${[0, 1, 2].map(cnt).join(', ')}], quân = ${S.units.length}, gold = [${S.gold.map(g => Math.floor(g / C.GOLD)).join(', ')}], thắng = ${S.winner}`);
console.log('TẤT CẢ KIỂM TRA ĐỀU ĐẠT');
