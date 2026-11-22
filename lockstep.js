// Lớp đồng bộ lockstep dùng chung cho trình duyệt và bài kiểm tra.
// Mỗi máy chỉ gửi lệnh của mình; server ghép lệnh theo tick và phát lại cho tất cả.
// Mọi máy áp dụng cùng danh sách lệnh ở cùng tick nên trạng thái luôn giống nhau.
(function (root) {
  'use strict';

  function Lockstep(opts) {
    this.core = opts.core;
    this.send = opts.send;
    this.tickMs = opts.tickMs;
    this.onStep = opts.onStep || function () {};
    this.onEnd = opts.onEnd || function () {};
    this.S = null; this.slot = -1; this.delay = 0; this.nextSend = 1;
    this.pending = []; this.bundles = new Map();
    this.timer = null; this.finished = false; this.endNotified = false;
    this.prevPos = new Map();
  }

  Lockstep.prototype.start = function (m) {
    this.S = this.core.createState({ seed: m.seed, players: m.players, ai: m.ai });
    this.slot = m.slot; this.delay = m.delay;
    if (m.history) {
      // Kết nối lại: phát lại toàn bộ lịch sử (không gửi hash trong lúc phát lại), rồi gửi tiếp từ tick hiện tại.
      this.silent = true;
      for (const b of m.history) this.onBundle(b);
      this.silent = false;
      this.nextSend = m.frame + this.delay;
      for (let k = m.frame; k < m.frame + this.delay; k++) this.send({ t: 'cmd', tick: k, cmds: [] });
    } else {
      // Gửi trước DELAY tick rỗng để server có lệnh cho các tick đầu.
      for (let k = 1; k <= this.delay; k++) this.send({ t: 'cmd', tick: k, cmds: [] });
      this.nextSend = this.delay + 1;
    }
    const self = this;
    this.timer = setInterval(function () { self.sendTick(); }, this.tickMs);
  };

  Lockstep.prototype.command = function (c) { if (!this.finished && this.S) this.pending.push(c); };

  // Chỉ gửi trước tối đa DELAY+2 tick so với tick đã thực thi, để không vượt giới hạn của server.
  Lockstep.prototype.sendTick = function () {
    if (!this.S || this.finished) return;
    if (this.S.ended) {
      this.send({ t: 'cmd', tick: this.nextSend++, cmds: this.pending.splice(0), done: true });
      this.stop();
      return;
    }
    if (this.nextSend > this.S.tick + this.delay + 2) return;
    this.send({ t: 'cmd', tick: this.nextSend++, cmds: this.pending.splice(0) });
  };

  Lockstep.prototype.onBundle = function (m) {
    if (!this.S || this.finished) return;
    this.bundles.set(m.tick, m.cmds);
    this.advance();
  };

  Lockstep.prototype.advance = function () {
    const S = this.S;
    while (!S.ended && this.bundles.has(S.tick + 1)) {
      const t = S.tick + 1;
      const cmds = this.bundles.get(t);
      this.bundles.delete(t);
      this.prevPos = new Map(S.units.map(u => [u.id, { x: u.x, y: u.y }]));
      this.core.step(S, cmds);
      if (S.tick % 50 === 0 && !this.silent) this.send({ t: 'hash', tick: S.tick, h: this.core.hash(S) });
      this.onStep(S);
    }
    if (S.ended) {
      this.bundles.clear();
      if (!this.endNotified) { this.endNotified = true; this.onEnd(S); }
    }
  };

  Lockstep.prototype.stop = function () {
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Lockstep;
  else root.Lockstep = Lockstep;
})(typeof window !== 'undefined' ? window : globalThis);
