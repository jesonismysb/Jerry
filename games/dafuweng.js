/* ==================================================================
 * 简易大富翁模块：2-4 人，24 格奈良主题环图，40 轮决胜负
 *  AI：简单（保守随机）/ 普通（预算内买地升级）/ 困难（积极扩张）
 *  联机：房主权威广播快照 {t:'state'}；客端发 {t:'act',kind}
 * ================================================================== */
(function () {
  'use strict';
  const NC = 24;
  const START_CASH = 1500;
  const GO_BONUS = 200;
  const MAX_ROUND = 40;
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308'];
  const P_NM = ['红', '蓝', '绿', '黄'];

  /* 地块：type p 地产 / c 机会 / t 税金 / g 起点 / r 休息 */
  const CELLS = [
    { t: 'g', nm: '起点' },
    { t: 'p', nm: '樱花小径', pr: 120, rt: 10 },
    { t: 'p', nm: '若草山', pr: 100, rt: 8 },
    { t: 'c', nm: '机会' },
    { t: 'p', nm: '东大寺', pr: 160, rt: 14 },
    { t: 't', nm: '税金', fee: 80 },
    { t: 'p', nm: '春日大社', pr: 180, rt: 16 },
    { t: 'p', nm: '奈良町', pr: 140, rt: 12 },
    { t: 'c', nm: '机会' },
    { t: 'p', nm: '兴福寺', pr: 200, rt: 18 },
    { t: 'p', nm: '猿泽池', pr: 140, rt: 12 },
    { t: 'p', nm: '平城宫迹', pr: 220, rt: 20 },
    { t: 'r', nm: '免费休息' },
    { t: 'p', nm: '吉野山', pr: 200, rt: 18 },
    { t: 'p', nm: '法隆寺', pr: 240, rt: 22 },
    { t: 't', nm: '重税', fee: 120 },
    { t: 'p', nm: '斑鸠之乡', pr: 220, rt: 20 },
    { t: 'c', nm: '机会' },
    { t: 'p', nm: '唐招提寺', pr: 260, rt: 24 },
    { t: 'p', nm: '药师寺', pr: 240, rt: 22 },
    { t: 'p', nm: '西大寺', pr: 180, rt: 16 },
    { t: 'c', nm: '机会' },
    { t: 'p', nm: '奈良公园', pr: 300, rt: 30 },
    { t: 'p', nm: '鹿苑', pr: 280, rt: 26 }
  ];

  /* 机会卡 */
  const CHANCES = [
    { d: +150, txt: '奈良小鹿送来祝福，获得 150 金币' },
    { d: -60, txt: '买了一堆鹿仙贝，损失 60 金币' },
    { d: +100, txt: '博客文章打赏收入 100 金币' },
    { d: -100, txt: '修缮古寺捐款 100 金币' },
    { d: +200, txt: '彩票中奖！获得 200 金币' },
    { d: -80, txt: '旅途遇雨生病，损失 80 金币' },
    { d: +120, txt: '捡到钱包上交，获表彰奖金 120 金币' },
    { d: -40, txt: '违章停车罚款 40 金币' },
    { d: +80, txt: '朋友还钱，获得 80 金币' },
    { d: -150, txt: '房屋漏水维修，损失 150 金币' }
  ];

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
    coin() { this.tone(880, 0.06, 'triangle', 0.1); setTimeout(() => this.tone(1180, 0.09, 'triangle', 0.1), 60); },
    pay() { this.tone(300, 0.1, 'sawtooth', 0.08); },
    bad() { this.tone(150, 0.2, 'sawtooth', 0.1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, i * 0.1)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.13)); }
  };

  class Monopoly {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.mySeat = opts.seat || 0;
      this.n = Math.min(4, Math.max(2, opts.count || 3));
      this.diff = opts.diff || 2;
      this.unsubs = [];
      this.dead = false;
      this.aiTimer = null;

      this.resetState();
      this.build();
      this.bindNet();
      this.draw();
      this.refreshPanel();
      if (!this.isNet && this.turn !== this.mySeat) this.scheduleAI();
    }

    resetState() {
      this.owner = new Int8Array(NC).fill(-1);
      this.level = new Int8Array(NC);
      this.cash = new Int32Array(this.n).fill(START_CASH);
      this.pos = new Int8Array(this.n);
      this.alive = new Int8Array(this.n).fill(1);
      this.turn = 0;
      this.round = 1;
      this.dice = 0;
      this.phase = 'roll';   // roll / buy / upgrade
      this.target = -1;
      this.over = false;
      this.winner = -1;
      this.logs = ['第 1 轮开始，' + P_NM[0] + '方行动'];
    }

    aliveList() {
      const a = [];
      this.alive.forEach((v, i) => { if (v) a.push(i); });
      return a;
    }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-4">
          <div class="board-box relative mx-auto w-full" style="max-width:540px">
            <canvas id="mf-canvas" class="block w-full rounded-xl"></canvas>
            <div id="mf-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
                 style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
              <div class="text-center px-6">
                <p id="mf-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
                <button id="mf-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
              </div>
            </div>
          </div>
          <div class="lg:w-60 flex flex-col gap-3 text-xs">
            <p id="mf-status" class="text-sm"></p>
            <button id="mf-roll" class="btn-primary"><i class="fa-solid fa-dice"></i>掷骰子</button>
            <div id="fx2-actions" class="flex flex-col gap-1.5"></div>
            <div id="mf-players" class="flex flex-col gap-1"></div>
            <div id="mf-log" class="text-[11px] text-slate-500 leading-relaxed border-t border-white/10 pt-2"></div>
          </div>
        </div>`;
      this.mount.appendChild(wrap);
      this.canvas = wrap.querySelector('#mf-canvas');
      this._resize = () => this.resize();
      window.addEventListener('resize', this._resize);
      this.resize();

      wrap.querySelector('#mf-roll').addEventListener('click', () => this.sendAct({ kind: 'roll' }));
      wrap.querySelector('#mf-again').addEventListener('click', () => {
        if (this.isNet) this.opts.room.send({ t: 'again' });
        this.reset();
      });
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || 520;
      this.canvas.style.height = w + 'px';
      this.canvas.width = w * dpr;
      this.canvas.height = w * dpr;
      this.cx = w / 2; this.cy = w / 2;
      this.R = w * 0.42;
      this.cell = w * 0.05;
      this.draw();
    }

    cellPos(k) {
      const a = -Math.PI / 2 + 2 * Math.PI * k / NC;
      return [this.cx + Math.cos(a) * this.R, this.cy + Math.sin(a) * this.R, a];
    }

    draw() {
      const cv = this.canvas; if (!cv) return;
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = cv.width / dpr;
      ctx.fillStyle = 'rgba(15,23,42,.55)';
      ctx.fillRect(0, 0, w, w);

      // 格子
      for (let k = 0; k < NC; k++) {
        const [x, y, a] = this.cellPos(k);
        const c = CELLS[k];
        let bg = 'rgba(148,163,184,.25)';
        if (c.t === 'g') bg = 'rgba(251,191,36,.4)';
        else if (c.t === 'c') bg = 'rgba(96,165,250,.35)';
        else if (c.t === 't') bg = 'rgba(244,63,94,.35)';
        else if (c.t === 'r') bg = 'rgba(148,163,184,.4)';
        else if (this.owner[k] >= 0) bg = COLORS[this.owner[k]] + '66';
        ctx.fillStyle = bg;
        const s = this.cell * 1.9;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
        this.rrectFill(ctx, -s / 2, -s / 2, s, s * 0.82, 3);
        ctx.restore();

        // 地产：等级圆点 + 价格
        if (c.t === 'p') {
          ctx.fillStyle = '#cbd5e1';
          ctx.font = this.cell * 0.55 + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.save();
          ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
          ctx.fillText(c.pr, 0, s * 0.18);
          ctx.restore();
          if (this.owner[k] >= 0) {
            for (let l = 0; l < this.level[k]; l++) {
              const [px0, py0] = [x + (l - (this.level[k] - 1) / 2) * this.cell * 0.4, y - s * 0.4];
              ctx.fillStyle = COLORS[this.owner[k]];
              ctx.beginPath(); ctx.arc(px0, py0, this.cell * 0.13, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
      }

      // 玩家棋子（同格错开）
      const onCell = {};
      this.alive.forEach((v, s) => {
        if (!v) return;
        const k = this.pos[s];
        (onCell[k] = onCell[k] || []).push(s);
      });
      Object.keys(onCell).forEach(k => {
        const seats = onCell[k], [x, y] = this.cellPos(+k);
        seats.forEach((s, i) => {
          const off = (i - (seats.length - 1) / 2) * this.cell * 0.5;
          ctx.fillStyle = COLORS[s];
          ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x + off, y + this.cell * 0.55, this.cell * 0.3, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        });
      });

      // 中心信息
      ctx.fillStyle = 'rgba(2,6,23,.6)';
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.cell * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold ' + this.cell * 1.3 + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('第 ' + this.round + ' 轮', this.cx, this.cy - this.cell * 0.4);
      if (this.dice) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = this.cell * 0.9 + 'px sans-serif';
        ctx.fillText('🎲 ' + this.dice, this.cx, this.cy + this.cell * 0.9);
      }
    }

    rrectFill(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
    }

    /* ---------------- 侧栏 ---------------- */
    myTurn() { return !this.over && this.turn === this.mySeat; }

    refreshPanel() {
      const st = document.getElementById('mf-status');
      if (st) {
        if (this.over) st.textContent = '对局结束';
        else st.textContent = P_NM[this.turn] + '方行动 · ' + this.phaseText();
      }
      const rollBtn = document.getElementById('mf-roll');
      if (rollBtn) {
        rollBtn.disabled = !(this.phase === 'roll' && this.myTurn());
        rollBtn.classList.toggle('opacity-40', rollBtn.disabled);
      }
      // 买地 / 升级按钮
      const box = document.getElementById('fx2-actions');
      if (box) {
        let html = '';
        if (this.myTurn() && this.phase === 'buy') {
          const c = CELLS[this.target];
          html = `<p class="text-slate-400">「${c.nm}」无主，价格 ${c.pr}（租金 ${c.rt}）</p>
            <button class="btn-primary" data-act="buy"><i class="fa-solid fa-coins"></i>购买</button>
            <button class="px-3 py-2 rounded-lg border border-white/15 text-slate-300" data-act="pass">放弃</button>`;
        } else if (this.myTurn() && this.phase === 'upgrade') {
          const c = CELLS[this.target], cost = Math.floor(c.pr / 2);
          html = `<p class="text-slate-400">自己的「${c.nm}」，花 ${cost} 升级到 ${this.level[this.target] + 1} 级</p>
            <button class="btn-primary" data-act="upgrade"><i class="fa-solid fa-arrow-up"></i>升级</button>
            <button class="px-3 py-2 rounded-lg border border-white/15 text-slate-300" data-act="pass">放弃</button>`;
        }
        box.innerHTML = html;
        box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
          this.sendAct({ kind: b.dataset.act });
        }));
      }
      // 玩家信息
      const pl = document.getElementById('mf-players');
      if (pl) {
        pl.innerHTML = this.cash.map((m, s) => {
          if (!this.alive[s]) return `<p class="text-slate-600 line-through"><span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style="background:${COLORS[s]}"></span>${P_NM[s]}方 已破产</p>`;
          const cur = s === this.turn && !this.over;
          return `<p class="flex items-center gap-1.5 ${cur ? 'text-slate-100' : 'text-slate-400'}">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${COLORS[s]}"></span>
            ${P_NM[s]}方 ${s === this.mySeat ? '（我）' : ''} ${cur ? '<i class="fa-solid fa-caret-right"></i>' : ''}
            <span class="ml-auto">💰${m}</span></p>`;
        }).join('');
      }
      const lg = document.getElementById('mf-log');
      if (lg) lg.innerHTML = this.logs.slice(-5).map(x => '<p>' + x + '</p>').join('');
    }

    phaseText() {
      if (this.phase === 'buy') return '选择买地或放弃';
      if (this.phase === 'upgrade') return '选择升级或放弃';
      return '请掷骰';
    }
    log(x) { this.logs.push(x); if (this.logs.length > 40) this.logs.shift(); }

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

    onRemote(msg) {
      if (!msg) return;
      if (msg.t === 'state') this.applyState(msg.s);
      else if (msg.t === 'again') this.reset();
    }

    serialize() {
      return {
        owner: Array.from(this.owner), level: Array.from(this.level),
        cash: Array.from(this.cash), pos: Array.from(this.pos), alive: Array.from(this.alive),
        turn: this.turn, round: this.round, dice: this.dice,
        phase: this.phase, target: this.target, over: this.over, winner: this.winner,
        logs: this.logs.slice(-10)
      };
    }
    applyState(s) {
      if (!s) return;
      this.owner = Int8Array.from(s.owner); this.level = Int8Array.from(s.level);
      this.cash = Int32Array.from(s.cash); this.pos = Int8Array.from(s.pos);
      this.alive = Int8Array.from(s.alive);
      this.turn = s.turn; this.round = s.round; this.dice = s.dice;
      this.phase = s.phase; this.target = s.target;
      this.over = s.over; this.winner = s.winner; this.logs = s.logs;
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
      if (act.kind === 'roll' && this.phase === 'roll') this.doRoll(seat);
      else if (act.kind === 'buy' && this.phase === 'buy') this.doBuy(seat, true);
      else if (act.kind === 'upgrade' && this.phase === 'upgrade') this.doUpgrade(seat);
      else if (act.kind === 'pass' && (this.phase === 'buy' || this.phase === 'upgrade')) this.endAction(seat);
    }

    doRoll(seat) {
      const d = 1 + Math.floor(Math.random() * 6);
      this.dice = d;
      Snd.dice();
      const old = this.pos[seat];
      const np = (old + d) % NC;
      this.pos[seat] = np;
      if (old + d >= NC) {
        this.cash[seat] += GO_BONUS;
        this.log(P_NM[seat] + '方经过起点，领取 ' + GO_BONUS + ' 金币');
      }
      this.log(P_NM[seat] + '方掷出 ' + d + '，到达「' + CELLS[np].nm + '」');
      this.handleLand(seat, np);
    }

    handleLand(seat, k) {
      const c = CELLS[k];
      if (c.t === 'p') {
        if (this.owner[k] === -1) {
          this.phase = 'buy'; this.target = k;
          this.broadcast(); this.afterAction(seat);
          return;
        }
        if (this.owner[k] === seat) {
          if (this.level[k] < 3 && this.cash[seat] >= Math.floor(c.pr / 2)) {
            this.phase = 'upgrade'; this.target = k;
            this.broadcast(); this.afterAction(seat);
            return;
          }
          this.log(P_NM[seat] + '方在自己的地产上休息');
          this.endAction(seat);
          return;
        }
        // 交租
        const rent = c.rt * this.level[k];
        this.payTo(seat, this.owner[k], rent);
        this.endAction(seat);
        return;
      }
      if (c.t === 'c') {
        const card = CHANCES[Math.floor(Math.random() * CHANCES.length)];
        this.log('机会：' + card.txt);
        if (card.d > 0) { this.cash[seat] += card.d; Snd.coin(); }
        else this.payTo(seat, -1, -card.d);
        this.endAction(seat);
        return;
      }
      if (c.t === 't') {
        this.log(P_NM[seat] + '方缴纳税金 ' + c.fee);
        this.payTo(seat, -1, c.fee);
        this.endAction(seat);
        return;
      }
      // 起点 / 休息
      this.endAction(seat);
    }

    /* 付款：to<0 表示付给银行；现金不足则破产 */
    payTo(seat, to, amount) {
      if (this.cash[seat] >= amount) {
        this.cash[seat] -= amount;
        if (to >= 0) this.cash[to] += amount;
        Snd.pay();
        if (to >= 0) this.log(P_NM[seat] + '方向 ' + P_NM[to] + '方支付 ' + amount + ' 金币租金');
        return false;
      }
      // 破产：剩余现金给债权人
      const rest = this.cash[seat];
      if (to >= 0) this.cash[to] += rest;
      this.cash[seat] = 0;
      this.goBankrupt(seat);
      return true;
    }

    goBankrupt(seat) {
      this.alive[seat] = 0;
      // 地产归还银行
      for (let k = 0; k < NC; k++) {
        if (this.owner[k] === seat) { this.owner[k] = -1; this.level[k] = 0; }
      }
      Snd.bad();
      this.log('💥 ' + P_NM[seat] + '方破产退出，地产归还银行');
      if (this.aliveList().length === 1) {
        this.over = true; this.winner = this.aliveList()[0];
      }
    }

    doBuy(seat, buy) {
      const k = this.target, c = CELLS[k];
      if (this.cash[seat] < c.pr) { this.endAction(seat); return; }
      this.cash[seat] -= c.pr;
      this.owner[k] = seat;
      this.level[k] = 1;
      Snd.coin();
      this.log(P_NM[seat] + '方买下「' + c.nm + '」');
      this.endAction(seat);
    }

    doUpgrade(seat) {
      const k = this.target, c = CELLS[k], cost = Math.floor(c.pr / 2);
      if (this.cash[seat] < cost || this.level[k] >= 3) { this.endAction(seat); return; }
      this.cash[seat] -= cost;
      this.level[k]++;
      Snd.coin();
      this.log(P_NM[seat] + '方将「' + c.nm + '」升到 ' + this.level[k] + ' 级');
      this.endAction(seat);
    }

    endAction(seat) {
      this.dice = 0; this.target = -1; this.phase = 'roll';
      if (this.over) { this.broadcast(); this.showResult(); return; }

      // 轮到下一位存活者
      let nx = seat;
      do { nx = (nx + 1) % this.n; } while (!this.alive[nx]);
      if (nx <= seat) this.round++;
      this.turn = nx;

      if (this.round > MAX_ROUND) {
        let best = -1, bm = -1;
        this.cash.forEach((m, s) => { if (this.alive[s] && m > bm) { bm = m; best = s; } });
        this.over = true; this.winner = best;
        this.log(MAX_ROUND + ' 轮结束，按金币定胜负');
        this.broadcast(); this.showResult();
        return;
      }
      this.log('第 ' + this.round + ' 轮：' + P_NM[nx] + '方行动');
      this.broadcast();
      this.afterAction(nx);
    }

    afterAction(seat) {
      if (this.over) { this.showResult(); return; }
      if (!this.isNet && seat !== this.mySeat) this.scheduleAI();
    }

    /* ---------------- AI ---------------- */
    scheduleAI() {
      if (this.dead || this.over) return;
      if (this.aiTimer) clearTimeout(this.aiTimer);
      this.aiTimer = setTimeout(() => this.runAI(), 650);
    }

    runAI() {
      if (this.dead || this.over) return;
      const seat = this.turn;
      if (seat === this.mySeat) return;
      if (this.phase === 'roll') { this.hostAct({ kind: 'roll' }, seat); return; }
      const k = this.target, c = CELLS[k];

      if (this.phase === 'buy') {
        let buy;
        if (this.diff === 1) buy = this.cash[seat] >= c.pr + 150 && Math.random() < 0.65;
        else if (this.diff === 2) buy = this.cash[seat] >= c.pr + 80;
        else buy = this.cash[seat] >= c.pr;     // 困难：买得起就买
        this.hostAct({ kind: buy ? 'buy' : 'pass' }, seat);
        return;
      }
      if (this.phase === 'upgrade') {
        const cost = Math.floor(c.pr / 2);
        let up;
        if (this.diff === 1) up = this.cash[seat] >= cost + 200 && Math.random() < 0.5;
        else if (this.diff === 2) up = this.cash[seat] >= cost + 150;
        else up = this.cash[seat] >= cost + 60;
        this.hostAct({ kind: up ? 'upgrade' : 'pass' }, seat);
      }
    }

    /* ---------------- 结算 ---------------- */
    showResult() {
      const overlay = document.getElementById('mf-overlay');
      const res = document.getElementById('mf-result');
      if (res) res.textContent = this.winner === this.mySeat ? '🏆 你获胜了！' : P_NM[this.winner] + '方获胜';
      if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
      const iWon = this.winner === this.mySeat;
      if (iWon) Snd.win(); else Snd.lose();
    }

    reset() {
      const overlay = document.getElementById('mf-overlay');
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
  window.GG.dafuweng = {
    start(mount, opts) { this._inst = new Monopoly(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
