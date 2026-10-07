/* ==================================================================
 * 飞行棋模块：2-6 人，环道 52 格 + 5 格冲刺道 + 终点
 *  AI：简单（随机）/ 普通（启发式贪心）/ 困难（全局打分贪心）
 *  联机：房主权威，广播完整状态快照 {t:'state'}；客端发 {t:'act',kind,ref}
 * ================================================================== */
(function () {
  'use strict';
  const TRACK = 52;
  const FINISH = 56;                 // 进度 0..50 环道，51..55 冲刺，56 终点
  const COLORS = ['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#d946ef', '#06b6d4'];
  const COLOR_NM = ['红', '黄', '蓝', '绿', '紫', '青'];

  /* 轻量 WebAudio 音效 */
  const Snd = {
    ctx: null,
    ac() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
      return this.ctx;
    },
    tone(freq, dur, type, vol, when) {
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.03);
    },
    dice() { this.tone(240, 0.06, 'square', 0.07); setTimeout(() => this.tone(200, 0.07, 'square', 0.07), 70); },
    takeoff() { [400, 560, 720].forEach((f, i) => this.tone(f, 0.09, 'triangle', 0.1, i * 0.06)); },
    bump() { this.tone(150, 0.18, 'sawtooth', 0.11); },
    arrive() { this.tone(700, 0.1, 'sine', 0.1); setTimeout(() => this.tone(880, 0.12, 'sine', 0.1), 80); },
    win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, i * 0.1)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.13)); }
  };

  class FlightChess {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.mySeat = opts.seat || 0;
      this.n = Math.min(6, Math.max(2, opts.count || 4));
      this.diff = opts.diff || 2;
      this.unsubs = [];
      this.dead = false;
      this.aiTimer = null;

      // 各色起飞点（均匀分布）与同色格
      this.start = [];
      for (let s = 0; s < this.n; s++) this.start.push(Math.floor(s * TRACK / this.n));
      this.cellColor = new Array(TRACK).fill(-1);
      for (let s = 0; s < this.n; s++) {
        [10, 32].forEach(off => { this.cellColor[(this.start[s] + off) % TRACK] = s; });
        this.cellColor[this.start[s]] = s;   // 起飞格也标同色
      }

      this.resetState();
      this.build();
      this.bindNet();
      this.draw();
      this.refreshPanel();
      if (!this.isNet && this.turn !== this.mySeat) this.scheduleAI();
    }

    resetState() {
      this.planes = [];
      for (let s = 0; s < this.n; s++) this.planes.push(new Int8Array(4).fill(-1));
      this.turn = 0;
      this.sixCount = 0;
      this.dice = 0;
      this.phase = 'roll';       // roll：待掷骰；pick：待选择行动
      this.over = false;
      this.winner = -1;
      this.logs = ['对局开始，' + COLOR_NM[0] + '方先掷骰'];
      this.actions = 0;
      this.options = [];
    }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-4">
          <div class="relative mx-auto w-full" style="max-width:520px">
            <canvas id="fx-canvas" class="block w-full rounded-xl"></canvas>
            <div id="fx-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
                 style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
              <div class="text-center px-6">
                <p id="fx-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
                <button id="fx-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
              </div>
            </div>
          </div>
          <div class="lg:w-60 flex flex-col gap-3 text-xs">
            <p id="fx-status" class="text-sm"></p>
            <button id="fx-roll" class="btn-primary"><i class="fa-solid fa-dice"></i>掷骰子</button>
            <div id="fx-picks" class="flex flex-col gap-1.5"></div>
            <div id="fx-players" class="flex flex-col gap-1"></div>
            <div id="fx-log" class="text-[11px] text-slate-500 leading-relaxed border-t border-white/10 pt-2"></div>
          </div>
        </div>`;
      this.mount.appendChild(wrap);
      this.canvas = wrap.querySelector('#fx-canvas');
      this._resize = () => this.resize();
      window.addEventListener('resize', this._resize);
      this.resize();

      wrap.querySelector('#fx-roll').addEventListener('click', () => this.sendAct({ kind: 'roll' }));
      wrap.querySelector('#fx-again').addEventListener('click', () => {
        if (this.isNet) this.opts.room.send({ t: 'again' });
        this.reset();
      });
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || 500;
      this.canvas.style.height = w + 'px';
      this.canvas.width = w * dpr;
      this.canvas.height = w * dpr;
      this.cx = w / 2; this.cy = w / 2;
      this.R = w * 0.40;
      this.cell = w * 0.052;
      this.draw();
    }

    trackPos(k) {
      const a = -Math.PI / 2 + 2 * Math.PI * k / TRACK;
      return [this.cx + Math.cos(a) * this.R, this.cy + Math.sin(a) * this.R, a];
    }
    stretchPos(seat, j) {
      const e = (this.start[seat] + 50) % TRACK;
      const a = -Math.PI / 2 + 2 * Math.PI * e / TRACK;
      const rr = this.R - this.cell * 1.6 * (j + 1);
      return [this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr];
    }

    draw() {
      const cv = this.canvas; if (!cv) return;
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = cv.width / dpr;

      ctx.fillStyle = 'rgba(15,23,42,.55)';
      ctx.fillRect(0, 0, w, w);

      // 中心
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.cell * 2.4, 0, Math.PI * 2); ctx.fill();

      // 冲刺道
      for (let s = 0; s < this.n; s++) {
        for (let j = 0; j < 5; j++) {
          const [x, y] = this.stretchPos(s, j);
          ctx.fillStyle = COLORS[s] + '55';
          this.rrect(ctx, x - this.cell / 2, y - this.cell / 2, this.cell, this.cell, 2);
        }
      }

      // 环道格
      for (let k = 0; k < TRACK; k++) {
        const [x, y] = this.trackPos(k);
        const cc = this.cellColor[k];
        ctx.fillStyle = cc >= 0 ? COLORS[cc] + '88' : 'rgba(148,163,184,.3)';
        this.rrect(ctx, x - this.cell / 2, y - this.cell / 2, this.cell, this.cell, 2.5);
      }

      // 飞机
      for (let s = 0; s < this.n; s++) {
        const groups = {};
        this.planes[s].forEach((p, i) => {
          if (p < 0) return;
          (groups[p] = groups[p] || []).push(i);
        });
        Object.keys(groups).forEach(p => {
          const ids = groups[p], n = ids.length;
          ids.forEach((id, k) => {
            let x, y;
            if (+p === FINISH) {
              const a = -Math.PI / 2 + 2 * Math.PI * s / this.n + 0.3 * (k - (n - 1) / 2);
              x = this.cx + Math.cos(a) * this.cell * 1.1; y = this.cy + Math.sin(a) * this.cell * 1.1;
            } else if (+p >= 51) {
              [x, y] = this.stretchPos(s, +p - 51);
            } else {
              [x, y] = this.trackPos((this.start[s] + +p) % TRACK);
            }
            const off = n > 1 ? (k - (n - 1) / 2) * this.cell * 0.5 : 0;
            this.drawPlane(ctx, x + off, y - (n > 1 ? Math.abs(k % 2) * 2 : 0), s, this.cell * 0.42);
          });
        });
      }

      // 骰子浮窗
      if (this.dice > 0) {
        ctx.fillStyle = 'rgba(2,6,23,.78)';
        ctx.beginPath(); ctx.arc(this.cx, this.cy, this.cell * 1.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fde68a';
        ctx.font = 'bold ' + this.cell * 1.2 + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.dice, this.cx, this.cy + 1);
      }
    }

    rrect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
    }

    drawPlane(ctx, x, y, seat, r) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = COLORS[seat];
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.85, r * 0.75);
      ctx.lineTo(0, r * 0.4);
      ctx.lineTo(-r * 0.85, r * 0.75);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    /* ---------------- 侧栏 ---------------- */
    activeHuman() {
      if (this.over) return false;
      return this.isNet ? this.turn === this.mySeat : this.turn === this.mySeat;
    }

    refreshPanel() {
      const st = document.getElementById('fx-status');
      if (st) {
        if (this.over) st.textContent = '对局结束';
        else st.textContent = COLOR_NM[this.turn] + '方回合 · ' + (this.phase === 'roll' ? '请掷骰' : '请选择行动');
      }
      const rollBtn = document.getElementById('fx-roll');
      if (rollBtn) {
        rollBtn.disabled = this.over || !(this.phase === 'roll' && this.activeHuman());
        rollBtn.classList.toggle('opacity-40', rollBtn.disabled);
      }
      // 行动选项
      const box = document.getElementById('fx-picks');
      if (box) {
        const show = this.phase === 'pick' && this.activeHuman();
        box.innerHTML = show ? this.options.map((o, i) =>
          `<button class="text-left px-3 py-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20" data-pick="${i}">${o.label}</button>`).join('') : '';
        box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
          this.sendAct({ kind: 'pick', ref: this.options[+b.dataset.pick].ref });
        }));
      }
      // 玩家
      const pl = document.getElementById('fx-players');
      if (pl) {
        pl.innerHTML = this.planes.map((arr, s) => {
          const done = arr.filter(p => +p === FINISH).length;
          const air = arr.filter(p => p >= 0 && p < FINISH).length;
          const cur = s === this.turn && !this.over;
          return `<p class="flex items-center gap-1.5 ${cur ? 'text-slate-100' : 'text-slate-400'}">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${COLORS[s]}"></span>
            ${COLOR_NM[s]}方 ${s === this.mySeat ? '（我）' : ''} ${cur ? '<i class="fa-solid fa-caret-right"></i>' : ''}
            <span class="ml-auto">✈${air} 🏁${done}</span></p>`;
        }).join('');
      }
      const lg = document.getElementById('fx-log');
      if (lg) lg.innerHTML = this.logs.slice(-4).map(x => '<p>' + x + '</p>').join('');
    }

    log(x) { this.logs.push(x); if (this.logs.length > 30) this.logs.shift(); }

    /* ---------------- 通信 ---------------- */
    sendAct(act) {
      if (this.isNet) this.opts.room.send(Object.assign({ t: 'act' }, act));
      else this.hostAct(act, this.mySeat);
    }

    bindNet() {
      if (!this.isNet) return;
      const un = this.opts.room.on('data', (msg, seat) => this.onRemote(msg, seat));
      this.unsubs.push(un);
    }

    onRemote(msg, seat) {
      if (!msg) return;
      if (msg.t === 'state') { this.applyState(msg.s); return; }
      if (msg.t === 'again') { this.reset(); return; }
      // 客端不处理裁判逻辑
    }

    serialize() {
      return {
        planes: this.planes.map(a => Array.from(a)),
        turn: this.turn, sixCount: this.sixCount, dice: this.dice,
        phase: this.phase, over: this.over, winner: this.winner,
        logs: this.logs.slice(-8), actions: this.actions,
        options: this.options.map(o => ({ ref: o.ref, label: o.label }))
      };
    }
    applyState(s) {
      if (!s) return;
      this.planes = s.planes.map(a => Int8Array.from(a));
      this.turn = s.turn; this.sixCount = s.sixCount; this.dice = s.dice;
      this.phase = s.phase; this.over = s.over; this.winner = s.winner;
      this.logs = s.logs; this.actions = s.actions; this.options = s.options;
      this.draw(); this.refreshPanel();
      if (this.over) this.showResult();
    }

    broadcast() {
      if (this.isNet) this.opts.room.send({ t: 'state', s: this.serialize() });
      else { this.draw(); this.refreshPanel(); }
    }

    /* ---------------- 房主裁判 ---------------- */
    hostAct(act, fromSeat) {
      if (this.over) return;
      const seat = this.isNet ? (fromSeat || 0) : this.turn;
      if (seat !== this.turn) return;

      if (act.kind === 'roll') {
        if (this.phase !== 'roll') return;
        this.doRoll(seat);
      } else if (act.kind === 'pick') {
        if (this.phase !== 'pick') return;
        if (!this.options.some(o => o.ref === act.ref)) return;
        this.doPick(seat, act.ref);
      }
    }

    doRoll(seat) {
      const d = 1 + Math.floor(Math.random() * 6);
      this.dice = d;
      this.actions++;
      Snd.dice();
      this.log(COLOR_NM[seat] + '方掷出 ' + d);
      if (d === 6) {
        this.sixCount++;
        if (this.sixCount >= 3) {
          this.log(COLOR_NM[seat] + '方连掷三个 6，行动作废');
          this.passTurn(seat);
          return;
        }
      } else {
        this.sixCount = 0;
      }
      this.buildOptions(seat, d);
      if (!this.options.length) {
        this.log(COLOR_NM[seat] + '方无可行行动');
        this.passTurn(seat, d !== 6);
        return;
      }
      this.phase = 'pick';
      this.broadcast();
      this.afterAction(seat);
    }

    /* 生成可选项：ref 编码 起飞=-(planeId+1)，移动=进度值 */
    buildOptions(seat, d) {
      const arr = this.planes[seat], opts = [];
      if (d === 6) {
        arr.forEach((p, i) => {
          if (p === -1) opts.push({ ref: -(i + 1), label: '🛫 让 ' + (i + 1) + ' 号飞机起飞' });
        });
      }
      const groups = new Set();
      arr.forEach(p => { if (p >= 0 && p < FINISH) groups.add(+p); });
      groups.forEach(p => {
        const n = arr.filter(x => +x === p).length;
        opts.push({ ref: p, label: '▶ 移动 ' + (p >= 51 ? '冲刺道' : '环道 ' + p) + ' 的 ' + n + ' 架飞机（+' + d + '）' });
      });
      this.options = opts;
    }

    doPick(seat, ref) {
      const d = this.dice, arr = this.planes[seat];
      this.options = [];
      if (ref < 0) {
        // 起飞
        const id = -ref - 1;
        if (arr[id] !== -1) return;
        arr[id] = 0;
        Snd.takeoff();
        this.log(COLOR_NM[seat] + '方 ' + (id + 1) + ' 号飞机起飞');
        this.dice = 0;
        this.resolveAfterAction(seat, true);
        return;
      }
      // 移动同进度的一组飞机
      const from = +ref;
      const ids = [];
      arr.forEach((p, i) => { if (+p === from) ids.push(i); });
      if (!ids.length) return;
      let to = from + d;
      if (to > FINISH) to = FINISH * 2 - to;   // 终点折返
      ids.forEach(i => { arr[i] = to; });
      this.log(COLOR_NM[seat] + '方 ' + ids.length + ' 架飞机前进到 ' + (to >= 51 ? '冲刺道' : to));

      // 撞机：落点有对方飞机 → 撞回，己方再进一格
      let bumped = 0;
      for (let s = 0; s < this.n; s++) {
        if (s === seat || to >= 51) continue;
        this.planes[s].forEach((p, i) => { if (+p === to) { this.planes[s][i] = -1; bumped++; } });
      }
      if (bumped) {
        Snd.bump();
        this.log('撞下 ' + bumped + ' 架对方飞机');
        let nt = to + 1;
        if (nt > FINISH) nt = FINISH;
        ids.forEach(i => { arr[i] = nt; });
        to = nt;
      }
      // 同色格跳 4（可连跳）
      let jumped = false, seen = new Set([to]);
      while (to <= 50 && this.cellColor[(this.start[seat] + to) % TRACK] === seat) {
        const nt = to + 4;
        if (nt > FINISH || seen.has(nt)) break;
        to = nt; jumped = true; seen.add(to);
        ids.forEach(i => { arr[i] = to; });
      }
      if (jumped) { Snd.arrive(); this.log(COLOR_NM[seat] + '方借同色格跃进'); }
      if (to === FINISH) Snd.arrive();

      this.dice = 0;
      this.resolveAfterAction(seat, d === 6);
    }

    /* 行动结束：判胜 → 同回合再掷（掷 6）或换人 */
    resolveAfterAction(seat, sameTurn) {
      if (this.planes[seat].every(p => +p === FINISH)) {
        this.over = true; this.winner = seat;
        this.phase = 'roll';
        this.broadcast();
        this.showResult();
        return;
      }
      if (this.actions > 1200) {
        // 超长保护：到达终点最多者胜
        let best = -1, bn = -1;
        this.planes.forEach((a, s) => { const n = a.filter(p => +p === FINISH).length; if (n > bn) { bn = n; best = s; } });
        this.over = true; this.winner = best;
        this.broadcast(); this.showResult();
        return;
      }
      if (sameTurn) {
        this.phase = 'roll';
        this.broadcast();
        this.afterAction(seat);
      } else {
        this.passTurn(seat, true);
      }
    }

    passTurn(seat, advance) {
      this.dice = 0;
      this.sixCount = 0;
      this.options = [];
      this.phase = 'roll';
      if (advance !== false) this.turn = (seat + 1) % this.n;
      this.broadcast();
      this.afterAction(this.turn);
    }

    afterAction(seat) {
      if (this.over) { this.showResult(); return; }
      if (!this.isNet && seat !== this.mySeat) this.scheduleAI();
    }

    /* ---------------- AI ---------------- */
    scheduleAI() {
      if (this.dead || this.over) return;
      if (this.aiTimer) clearTimeout(this.aiTimer);
      this.aiTimer = setTimeout(() => this.runAI(), this.diff === 1 ? 500 : 680);
    }

    runAI() {
      if (this.dead || this.over) return;
      const seat = this.turn;
      if (seat === this.mySeat) return;
      if (this.phase === 'roll') { this.hostAct({ kind: 'roll' }, seat); return; }
      // pick：评估选项
      const d = this.dice;
      let best = -Infinity, ref = this.options[0].ref;
      for (const o of this.options) {
        let v;
        if (o.ref < 0) {
          // 起飞价值
          v = this.diff === 1 ? Math.random() * 10 : 12 + Math.random() * 4;
        } else {
          const from = +o.ref;
          let to = from + d;
          if (to > FINISH) to = FINISH * 2 - to;
          v = (to - from) * 0.8;
          if (to >= 51) v += 8;
          if (to === FINISH) v += 30;
          // 撞机收益
          if (to <= 50) {
            for (let s = 0; s < this.n; s++) {
              if (s === seat) continue;
              this.planes[s].forEach(p => { if (+p === to) v += this.diff === 3 ? 22 : 10; });
            }
          }
          // 同色格
          if (to <= 50 && this.cellColor[(this.start[seat] + to) % TRACK] === seat) v += this.diff === 3 ? 14 : 6;
          if (this.diff === 1) v = Math.random() * 12;
          v += Math.random() * 1.5;
        }
        if (v > best) { best = v; ref = o.ref; }
      }
      this.hostAct({ kind: 'pick', ref }, seat);
    }

    /* ---------------- 结算 ---------------- */
    showResult() {
      const overlay = document.getElementById('fx-overlay');
      const res = document.getElementById('fx-result');
      if (res) res.textContent = this.winner === this.mySeat ? '🏆 你获胜了！' : COLOR_NM[this.winner] + '方获胜';
      if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
      const iWon = this.winner === this.mySeat;
      if (iWon) Snd.win(); else Snd.lose();
    }

    reset() {
      const overlay = document.getElementById('fx-overlay');
      if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('flex'); }
      if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
      this.resetState();
      this.broadcast();
      if (!this.isNet && this.turn !== this.mySeat) this.scheduleAI();
    }

    stop() {
      this.dead = true;
      if (this.aiTimer) clearTimeout(this.aiTimer);
      this.unsubs.forEach(un => { try { un(); } catch (e) {} });
      window.removeEventListener('resize', this._resize);
      this.mount.innerHTML = '';
    }
  }

  window.GG = window.GG || {};
  window.GG.feixing = {
    start(mount, opts) { this._inst = new FlightChess(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
