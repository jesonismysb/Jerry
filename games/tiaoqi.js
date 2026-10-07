/* ==================================================================
 * 跳棋模块：六角星形棋盘 121 个棋位，每方 10 子
 *  AI：简单（随机）/ 普通（进度贪心）/ 困难（两层 Alpha-Beta 搜索）
 *  联机：房主在上方营区先行，信令 {t:'mv',from,to}，再来一局 {t:'again'}
 * ================================================================== */
(function () {
  'use strict';

  /* 17 行棋位数量：1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1 */
  const LENS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
  const HSTEP = Math.sqrt(3) / 2;

  // 建立棋位坐标（以水平单位 1 计）与邻接图（距离≈1 即相连）
  const HOLES = [];
  LENS.forEach((len, r) => {
    for (let i = 0; i < len; i++) {
      HOLES.push({ x: i - (len - 1) / 2, y: r * HSTEP, row: r });
    }
  });
  const NHOLE = HOLES.length;
  const NB = Array.from({ length: NHOLE }, () => []);
  for (let i = 0; i < NHOLE; i++) {
    for (let j = i + 1; j < NHOLE; j++) {
      const dx = HOLES[i].x - HOLES[j].x, dy = HOLES[i].y - HOLES[j].y;
      if (Math.abs(dx * dx + dy * dy - 1) < 0.07) { NB[i].push(j); NB[j].push(i); }
    }
  }
  const CAMP_TOP = [], CAMP_BOT = [];
  HOLES.forEach((h, i) => {
    if (h.row <= 3) CAMP_TOP.push(i);
    if (h.row >= 13) CAMP_BOT.push(i);
  });

  // 坐标 → 棋位索引（落点反查用）
  const COORD2I = new Map();
  HOLES.forEach((h, i) => COORD2I.set(h.x.toFixed(3) + ',' + h.y.toFixed(3), i));
  /* A、B 相邻时，B 关于 A 的对称点（跳过 B 的落点），无棋位返回 -1 */
  function landHole(a, b) {
    const ex = 2 * HOLES[b].x - HOLES[a].x, ey = 2 * HOLES[b].y - HOLES[a].y;
    const k = COORD2I.get(ex.toFixed(3) + ',' + ey.toFixed(3));
    return k == null ? -1 : k;
  }

  const TOP = 1, BOTTOM = 2;

  /* BFS：每个棋位到某营区的最短距离（用于 AI 进度评估） */
  function campDist(camp) {
    const d = new Array(NHOLE).fill(1e6);
    const q = camp.slice();
    q.forEach(i => { d[i] = 0; });
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      NB[cur].forEach(n => { if (d[n] > d[cur] + 1) { d[n] = d[cur] + 1; q.push(n); } });
    }
    return d;
  }

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
    step() { this.tone(340, 0.08, 'triangle', 0.11); },
    jump() { this.tone(480, 0.08, 'sine', 0.1); },
    win() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.13)); }
  };

  class ChineseCheckers {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.mySide = opts.seat === 0 ? TOP : BOTTOM;
      this.aiSide = this.isNet ? 0 : (this.mySide === TOP ? BOTTOM : TOP);
      this.diff = opts.diff || 2;
      this.unsubs = [];
      this.dead = false;
      this.timer = null;

      this.resetState();
      this.build();
      this.bindNet();
      this.draw();
      this.updateStatus();
      if (!this.isNet && this.turn === this.aiSide) this.aiThink();
    }

    resetState() {
      this.occ = new Int8Array(NHOLE);   // 0 空，1/2 棋子
      CAMP_TOP.forEach(h => { this.occ[h] = TOP; });
      CAMP_BOT.forEach(h => { this.occ[h] = BOTTOM; });
      this.turn = TOP;
      this.over = false;
      this.winner = 0;
      this.sel = null;
      this.path = null;       // 连跳进行中的路径
    }

    targetCamp(side) { return side === TOP ? CAMP_BOT : CAMP_TOP; }
    distMap(side) { return side === TOP ? this._dB || (this._dB = campDist(CAMP_BOT))
      : this._dT || (this._dT = campDist(CAMP_TOP)); }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="tq-status" class="text-xs sm:text-sm"></p>
          <button id="tq-endmove" class="hidden text-[11px] px-3 py-1.5 rounded-lg bg-amber-400/15 text-amber-200 border border-amber-300/30">
            <i class="fa-solid fa-flag-checkered mr-1"></i>结束移动
          </button>
        </div>
        <div id="tq-boardwrap" class="relative mx-auto" style="max-width:460px">
          <canvas id="tq-canvas" class="block w-full rounded-xl cursor-pointer"></canvas>
          <div id="tq-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
               style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
            <div class="text-center px-6">
              <p id="tq-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
              <button id="tq-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
            </div>
          </div>
        </div>`;
      this.mount.appendChild(wrap);
      this.canvas = wrap.querySelector('#tq-canvas');
      this._resize = () => this.resize();
      window.addEventListener('resize', this._resize);
      this.resize();

      this.canvas.addEventListener('click', e => this.onClick(e));
      wrap.querySelector('#tq-endmove').addEventListener('click', () => this.finishMove());
      wrap.querySelector('#tq-again').addEventListener('click', () => {
        if (this.isNet) this.opts.room.send({ t: 'again' });
        this.reset();
      });
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || 440;
      // 宽度 14 单位（13 + 边距），高度 16*HSTEP + 边距
      const h = w * (16 * HSTEP + 1.2) / 14;
      this.canvas.style.height = h + 'px';
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      const unit = Math.min(w / 14, h / (16 * HSTEP + 1.2));
      this.scale = unit;
      this.ox = w / 2;
      this.oy = (h - 16 * HSTEP * unit) / 2;
      this.draw();
    }

    holeXY(i) {
      const h = HOLES[i];
      return [this.ox + h.x * this.scale, this.oy + h.y * this.scale];
    }

    draw() {
      const cv = this.canvas; if (!cv) return;
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const campSet = (camp, v) => { ctx.fillStyle = v; camp.forEach(i => { const [x, y] = this.holeXY(i); ctx.beginPath(); ctx.arc(x, y, this.scale * 0.34, 0, Math.PI * 2); ctx.fill(); }); };
      campSet(CAMP_TOP, 'rgba(248,113,113,.13)');
      campSet(CAMP_BOT, 'rgba(96,165,250,.13)');

      // 棋位
      for (let i = 0; i < NHOLE; i++) {
        const [x, y] = this.holeXY(i);
        ctx.fillStyle = 'rgba(203,213,225,.85)';
        ctx.beginPath(); ctx.arc(x, y, this.scale * 0.11, 0, Math.PI * 2); ctx.fill();
      }

      // 可走目标提示
      if (this.hints && this.hints.size) {
        ctx.fillStyle = 'rgba(253,224,71,.32)';
        this.hints.forEach(i => {
          const [x, y] = this.holeXY(i);
          ctx.beginPath(); ctx.arc(x, y, this.scale * 0.24, 0, Math.PI * 2); ctx.fill();
        });
      }

      // 连跳路径
      if (this.path && this.path.length > 1) {
        ctx.strokeStyle = 'rgba(253,224,71,.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        this.path.forEach((p, k) => { const [x, y] = this.holeXY(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.lineWidth = 1;
      }

      // 棋子
      for (let i = 0; i < NHOLE; i++) {
        const v = this.occ[i]; if (!v) continue;
        const [x, y] = this.holeXY(i), rad = this.scale * 0.34;
        const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
        if (v === TOP) { g.addColorStop(0, '#fca5a5'); g.addColorStop(1, '#b91c1c'); }
        else { g.addColorStop(0, '#93c5fd'); g.addColorStop(1, '#1d4ed8'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        if (this.sel === i || (this.path && this.path[this.path.length - 1] === i)) {
          ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, rad + 2, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }

    /* ---------------- 走法生成 ---------------- */
    /* 从 from 出发，单步落点 + 全部连跳落点（DFS） */
    pieceDestinations(occ, from, side) {
      const camp = this.targetCamp(side);
      const inCamp = i => camp.includes(i);
      const allowed = to => !(inCamp(from) && !inCamp(to));   // 已进对方营区的棋子不可再移出
      const dests = new Map();   // to -> 'step' / 'jump'

      NB[from].forEach(n => {
        if (!occ[n] && allowed(n)) dests.set(n, 'step');
      });

      const visited = new Set([from]);
      const dfs = cur => {
        NB[cur].forEach(n => {
          if (!occ[n]) return;
          const land = landHole(cur, n);
          if (land < 0 || visited.has(land) || occ[land]) return;
          if (!allowed(land)) return;
          visited.add(land);
          if (!dests.has(land)) dests.set(land, 'jump');
          dfs(land);
        });
      };
      dfs(from);
      return dests;
    }

    /* 某方全部走法（供 AI；每个走法 {from,to}） */
    allMoves(occ, side) {
      const list = [];
      for (let i = 0; i < NHOLE; i++) {
        if (occ[i] !== side) continue;
        this.pieceDestinations(occ, i, side).forEach((kind, to) => list.push({ from: i, to, kind }));
      }
      return list;
    }

    /* 连跳继续时，从 cur 出发还能跳到的落点 */
    jumpConts(cur, side) {
      const camp = this.targetCamp(side);
      const inCamp = i => camp.includes(i);
      const out = [];
      NB[cur].forEach(n => {
        if (!this.occ[n]) return;
        const land = landHole(cur, n);
        if (land < 0 || this.occ[land]) return;
        if (inCamp(cur) && !inCamp(land)) return;
        out.push(land);
      });
      return out;
    }

    /* ---------------- 交互 ---------------- */
    pickHole(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let best = -1, bd = 1e9;
      for (let i = 0; i < NHOLE; i++) {
        const [x, y] = this.holeXY(i);
        const d = (x - mx) * (x - mx) + (y - my) * (y - my);
        if (d < bd) { bd = d; best = i; }
      }
      return bd < (this.scale * 0.42) * (this.scale * 0.42) ? best : -1;
    }

    canAct() {
      if (this.over) return false;
      return this.isNet ? this.turn === this.mySide : this.turn !== this.aiSide;
    }

    onClick(e) {
      if (!this.canAct()) return;
      const i = this.pickHole(e);
      if (i < 0) return;
      const side = this.turn;

      // 连跳进行中：只能继续跳或点结束
      if (this.path) {
        const cur = this.path[this.path.length - 1];
        if (this.jumpConts(cur, side).includes(i)) {
          this.occ[i] = side; this.occ[cur] = 0;
          this.path.push(i);
          Snd.jump();
          this.refreshHints();
          this.draw();
        } else {
          this.opts.toast('可继续连跳，或点击「结束移动」');
        }
        return;
      }

      if (this.sel != null && i !== this.sel) {
        const dests = this.pieceDestinations(this.occ, this.sel, side);
        if (dests.has(i)) {
          const kind = dests.get(i);
          this.occ[i] = side; this.occ[this.sel] = 0;
          this.path = [this.sel, i];
          if (kind === 'step') { this.finishMove(); return; }
          Snd.jump();
          this.refreshHints();
          // 没有后续跳点时自动结束
          if (!this.jumpConts(i, side).length) { this.finishMove(); return; }
          this.draw();
          this.opts.toast('可继续连跳，完成后请点「结束移动」');
          return;
        }
      }
      if (this.occ[i] === side) {
        this.sel = i;
        this.hints = new Set(this.pieceDestinations(this.occ, i, side).keys());
        this.draw();
      } else {
        this.sel = null; this.hints = null; this.draw();
      }
    }

    refreshHints() {
      const cur = this.path[this.path.length - 1];
      this.sel = cur;
      this.hints = new Set(this.jumpConts(cur, this.turn));
      document.getElementById('tq-endmove').classList.toggle('hidden', !this.hints.size);
    }

    finishMove() {
      const from = this.path[0], to = this.path[this.path.length - 1];
      this.sel = null; this.hints = null; this.path = null;
      document.getElementById('tq-endmove').classList.add('hidden');
      if (!this.occ[to]) return;   // 保险
      Snd.step();

      // 胜利：对方营区 10 格全部被己方填满
      const camp = this.targetCamp(this.turn);
      if (camp.every(h => this.occ[h] === this.turn)) {
        this.over = true; this.winner = this.turn;
        this.draw(); this.finish();
        if (this.isNet) this.opts.room.send({ t: 'mv', from, to });
        return;
      }
      if (this.isNet) this.opts.room.send({ t: 'mv', from, to });
      this.turn = this.turn === TOP ? BOTTOM : TOP;
      this.draw();
      this.updateStatus();
      if (!this.isNet && this.turn === this.aiSide) this.aiThink();
    }

    updateStatus() {
      const el = document.getElementById('tq-status'); if (!el) return;
      if (this.over) { el.textContent = '对局结束'; return; }
      const tName = this.turn === TOP ? '上方一方' : '下方一方';
      el.textContent = this.isNet
        ? (this.turn === this.mySide ? '轮到你（' + tName + '）行动' : '等待对方（' + tName + '）行动')
        : (this.turn === this.aiSide ? 'AI（' + tName + '）思考中…' : '轮到你（' + tName + '）行动');
    }

    finish() {
      const overlay = document.getElementById('tq-overlay');
      const res = document.getElementById('tq-result');
      const text = this.isNet
        ? (this.winner === this.mySide ? '你赢了！' : '你输了…')
        : (this.winner === this.mySide ? '你赢了！' : 'AI 获胜');
      if (res) res.textContent = text;
      if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
      const iWon = this.winner === this.mySide;
      if (iWon) Snd.win(); else Snd.lose();
      this.updateStatus();
    }

    reset() {
      const overlay = document.getElementById('tq-overlay');
      if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('flex'); }
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.resetState();
      this.draw();
      this.updateStatus();
      if (!this.isNet && this.turn === this.aiSide) this.aiThink();
    }

    /* ---------------- 联机 ---------------- */
    bindNet() {
      if (!this.isNet) return;
      const un = this.opts.room.on('data', msg => this.onRemote(msg));
      this.unsubs.push(un);
    }
    onRemote(msg) {
      if (!msg) return;
      if (msg.t === 'mv') {
        if (this.over || this.occ[msg.from] !== this.turn) return;
        const side = this.turn;
        const m = this.allMoves(this.occ, side).find(x => x.from === msg.from && x.to === msg.to);
        if (!m) return;
        this.occ[msg.to] = side; this.occ[msg.from] = 0;
        const camp = this.targetCamp(side);
        if (camp.every(h => this.occ[h] === side)) { this.over = true; this.winner = side; this.draw(); this.finish(); return; }
        this.turn = side === TOP ? BOTTOM : TOP;
        this.draw(); this.updateStatus();
      } else if (msg.t === 'again') {
        this.reset();
      }
    }

    /* ---------------- AI ---------------- */
    /* 进度评估：到目标营区的总距离，越小越好；返回对 side 的有利度（越大越好） */
    evalSide(occ, side) {
      const dmap = this.distMap(side);
      let score = 0;
      const camp = this.targetCamp(side);
      for (let i = 0; i < NHOLE; i++) {
        if (occ[i] === side) {
          score -= dmap[i];
          if (camp.includes(i)) score += 3;     // 已进营奖励
        }
      }
      return score;
    }

    /* 两层负极大值：我方走一步 + 对手最佳回应 */
    search2(occ, side) {
      const opp = side === TOP ? BOTTOM : TOP;
      let moves = this.allMoves(occ, side);
      // 进步大的走法优先排序
      const dmap = this.distMap(side);
      moves.sort((a, b) => (dmap[a.from] - dmap[a.to]) - (dmap[b.from] - dmap[b.to]));
      let best = -Infinity, pick = moves[0];
      for (const m of moves) {
        const nb = occ.slice();
        nb[m.to] = side; nb[m.from] = 0;
        // 对手的最佳回应
        let theirs = this.allMoves(nb, opp);
        let worst = Infinity;
        const dmapO = this.distMap(opp);
        theirs.sort((a, b) => (dmapO[b.from] - dmapO[b.to]) - (dmapO[a.from] - dmapO[a.to]));
        for (const om of theirs) {
          const ob = nb.slice();
          ob[om.to] = opp; ob[om.from] = 0;
          const v = this.evalSide(ob, side) - this.evalSide(ob, opp);
          if (v < worst) worst = v;
        }
        if (!theirs.length) worst = this.evalSide(nb, side);
        worst += Math.random() * 0.6;
        if (worst > best) { best = worst; pick = m; }
      }
      return pick;
    }

    aiThink() {
      if (this.dead || this.over) return;
      const side = this.turn;
      const moves = this.allMoves(this.occ, side);
      if (!moves.length) return;
      this.updateStatus();
      this.timer = setTimeout(() => {
        if (this.dead) return;
        let pick;
        if (this.diff === 1) {
          pick = moves[Math.floor(Math.random() * moves.length)];
        } else if (this.diff === 2) {
          // 普通：选择单步进度收益最大的落点，平局时小幅随机
          const dmap = this.distMap(side);
          let best = -Infinity;
          moves.forEach(m => {
            const gain = dmap[m.from] - dmap[m.to] + Math.random() * 0.8;
            if (gain > best) { best = gain; pick = m; }
          });
        } else {
          pick = this.search2(this.occ, side);
        }
        if (pick) {
          this.occ[pick.to] = side; this.occ[pick.from] = 0;
          const camp = this.targetCamp(side);
          if (camp.every(h => this.occ[h] === side)) { this.over = true; this.winner = side; this.draw(); this.finish(); return; }
          Snd.step();
          this.turn = side === TOP ? BOTTOM : TOP;
          this.draw(); this.updateStatus();
          if (!this.isNet && this.turn === this.aiSide) this.aiThink();
        }
      }, this.diff === 3 ? 600 : 420);
    }

    stop() {
      this.dead = true;
      if (this.timer) clearTimeout(this.timer);
      this.unsubs.forEach(un => { try { un(); } catch (e) {} });
      window.removeEventListener('resize', this._resize);
      this.mount.innerHTML = '';
    }
  }

  window.GG = window.GG || {};
  window.GG.tiaoqi = {
    start(mount, opts) { this._inst = new ChineseCheckers(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
