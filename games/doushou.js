/* ==================================================================
 * 斗兽棋模块：7×9 棋盘（河流 / 陷阱 / 兽穴）
 *  AI：简单（随机）/ 普通（贪心评估）/ 困难（Alpha-Beta 搜索）
 *  联机：房主执下方一方先行，信令 {t:'mv',fr,fc,tr,tc}，再来一局 {t:'again'}
 * ================================================================== */
(function () {
  'use strict';
  const COLS = 7, ROWS = 9;
  const TOP = 1, BOTTOM = 2;            // TOP 营在上方(row0)，BOTTOM 营在下方(row8)
  // 棋子编码：side*10 + rank；等级 1鼠 2猫 3狗 4狼 5豹 6虎 7狮 8象
  const RANK_CH = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };

  const TRAPS = {
    [TOP]: [[2, 0], [4, 0], [3, 1]],
    [BOTTOM]: [[2, 8], [4, 8], [3, 7]]
  };
  const DEN = { [TOP]: [3, 0], [BOTTOM]: [3, 8] };
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const pside = v => v >= 20 ? BOTTOM : TOP;
  const prank = v => v % 10;

  function isWater(r, c) {
    return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5);
  }
  function trapOwner(r, c) {
    for (const s of [TOP, BOTTOM]) {
      if (TRAPS[s].some(t => t[0] === c && t[1] === r)) return s;
    }
    return 0;
  }
  const idx = (r, c) => r * COLS + c;

  /* 初始布阵 */
  function initBoard() {
    const b = new Int8Array(COLS * ROWS);
    const put = (side, rank, r, c) => { b[idx(r, c)] = side * 10 + rank; };
    // 上方（TOP）
    put(TOP, 7, 0, 0); put(TOP, 6, 0, 6);
    put(TOP, 3, 1, 2); put(TOP, 2, 1, 4);
    put(TOP, 1, 2, 0); put(TOP, 5, 2, 2); put(TOP, 4, 2, 4); put(TOP, 8, 2, 6);
    // 下方（BOTTOM）
    put(BOTTOM, 8, 6, 0); put(BOTTOM, 4, 6, 2); put(BOTTOM, 5, 6, 4); put(BOTTOM, 1, 6, 6);
    put(BOTTOM, 2, 7, 2); put(BOTTOM, 3, 7, 4);
    put(BOTTOM, 6, 8, 0); put(BOTTOM, 7, 8, 6);
    return b;
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
    move() { this.tone(320, 0.08, 'triangle', 0.12); },
    capture() { this.tone(180, 0.16, 'sawtooth', 0.1); setTimeout(() => this.tone(140, 0.12, 'sawtooth', 0.08), 60); },
    jump() { this.tone(440, 0.07, 'sine', 0.1); setTimeout(() => this.tone(620, 0.09, 'sine', 0.1), 70); },
    invalid() { this.tone(130, 0.1, 'square', 0.06); },
    win() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.13)); }
  };

  class Jungle {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.mySide = opts.seat === 0 ? BOTTOM : TOP;   // 房主/玩家固定下方
      this.aiSide = this.isNet ? 0 : (this.mySide === BOTTOM ? TOP : BOTTOM);
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
      this.board = initBoard();
      this.turn = BOTTOM;    // 下方先行
      this.over = false;
      this.winner = 0;
      this.sel = null;
      this.pliesNoCap = 0;
    }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="ds-status" class="text-xs sm:text-sm"></p>
          <p class="text-[11px] text-slate-500">点击己方棋子，再点目标格移动</p>
        </div>
        <div id="ds-boardwrap" class="relative mx-auto" style="max-width:440px">
          <canvas id="ds-canvas" class="block w-full rounded-xl cursor-pointer"></canvas>
          <div id="ds-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
               style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
            <div class="text-center px-6">
              <p id="ds-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
              <button id="ds-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
            </div>
          </div>
        </div>`;
      this.mount.appendChild(wrap);
      this.canvas = wrap.querySelector('#ds-canvas');
      this._resize = () => this.resize();
      window.addEventListener('resize', this._resize);
      this.resize();

      this.canvas.addEventListener('click', e => this.onClick(e));
      wrap.querySelector('#ds-again').addEventListener('click', () => {
        if (this.isNet) this.opts.room.send({ t: 'again' });
        this.reset();
      });
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || 420;
      const h = w * ROWS / COLS;
      this.canvas.style.height = h + 'px';
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.cw = w / COLS; this.chh = h / ROWS;
      this.draw();
    }

    draw() {
      const cv = this.canvas; if (!cv) return;
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = cv.width / dpr, h = cv.height / dpr;
      const cw = this.cw || w / COLS, chh = this.chh || h / ROWS;

      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const x = c * cw, y = r * chh;
        ctx.fillStyle = isWater(r, c) ? '#2b6cb0' : '#2f7d4f';
        ctx.fillRect(x, y, cw, chh);
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, chh - 1);

        // 陷阱
        const to = trapOwner(r, c);
        if (to) {
          ctx.strokeStyle = to === TOP ? 'rgba(252,165,165,.9)' : 'rgba(147,197,253,.9)';
          ctx.lineWidth = 2;
          const p = Math.min(cw, chh) * 0.26, cx = x + cw / 2, cy = y + chh / 2;
          ctx.beginPath();
          ctx.moveTo(cx - p, cy - p); ctx.lineTo(cx + p, cy + p);
          ctx.moveTo(cx + p, cy - p); ctx.lineTo(cx - p, cy + p);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        // 兽穴
        for (const s of [TOP, BOTTOM]) {
          if (DEN[s][0] === c && DEN[s][1] === r) {
            ctx.fillStyle = s === TOP ? 'rgba(252,165,165,.25)' : 'rgba(147,197,253,.25)';
            ctx.fillRect(x, y, cw, chh);
            ctx.fillStyle = '#e2e8f0';
            ctx.font = Math.min(cw, chh) * 0.5 + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('穴', x + cw / 2, y + chh / 2);
          }
        }
      }

      // 选中与可走点
      if (this.sel) {
        const [sr, sc] = this.sel;
        ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 3;
        ctx.strokeRect(sc * cw + 2, sr * chh + 2, cw - 4, chh - 4);
        ctx.lineWidth = 1;
        const moves = this.movesFrom(this.board, sr, sc);
        moves.forEach(m => {
          ctx.fillStyle = 'rgba(253,230,138,.3)';
          ctx.fillRect(m.tr * cw + 2, m.tc * chh + 2, cw - 4, chh - 4);
        });
      }

      // 棋子
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = this.board[idx(r, c)]; if (!v) continue;
        const s = pside(v), rank = prank(v);
        const cx = c * cw + cw / 2, cy = r * chh + chh / 2, rad = Math.min(cw, chh) * 0.4;
        const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
        if (s === TOP) { g.addColorStop(0, '#fca5a5'); g.addColorStop(1, '#b91c1c'); }
        else { g.addColorStop(0, '#93c5fd'); g.addColorStop(1, '#1d4ed8'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + rad * 0.95 + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(RANK_CH[rank], cx, cy + 1);
      }
    }

    /* ---------------- 走法规则 ---------------- */
    canCapture(board, ar, ac, tr, tc) {
      const av = board[idx(ar, ac)], tv = board[idx(tr, tc)];
      if (!tv) return true;
      const atkSide = pside(av), defSide = pside(tv);
      if (atkSide === defSide) return false;
      const aInW = isWater(ar, ac), dInW = isWater(tr, tc);
      if (aInW !== dInW) return false;   // 鼠水/陆不能越界攻击
      const arank = prank(av);
      let drank = prank(tv);
      if (trapOwner(tr, tc) === atkSide) drank = 0;   // 进入对方陷阱的棋子战斗力为 0
      if (arank === 1 && drank === 8) return true;    // 鼠吃象
      return arank >= drank;
    }

    movesFrom(board, r, c) {
      const v = board[idx(r, c)]; if (!v) return [];
      const side = pside(v), rank = prank(v);
      const out = [];
      const add = (tr, tc) => {
        if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return;
        // 不能进自己的兽穴
        const den = DEN[side];
        if (den[0] === tc && den[1] === tr) return;
        const tv = board[idx(tr, tc)];
        if (!tv || (pside(tv) !== side && this.canCapture(board, r, c, tr, tc))) {
          out.push({ fr: r, fc: c, tr, tc, cap: !!tv });
        }
      };

      // 普通一步（鼠在水中照常一步）
      for (const [dr, dc] of DIRS) add(r + dr, c + dc);

      // 狮 / 虎：直线跃河
      if (rank >= 6 && !isWater(r, c)) {
        for (const [dr, dc] of DIRS) {
          let rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || !isWater(rr, cc)) continue;
          let blocked = false, water = [];
          while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && isWater(rr, cc)) {
            const wv = board[idx(rr, cc)];
            if (wv && prank(wv) === 1) blocked = true;   // 河中有鼠挡道
            water.push([rr, cc]); rr += dr; cc += dc;
          }
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          if (!blocked) add(rr, cc);
        }
      }
      return out;
    }

    allMoves(board, side) {
      const list = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = board[idx(r, c)];
        if (v && pside(v) === side) {
          this.movesFrom(board, r, c).forEach(m => list.push(m));
        }
      }
      return list;
    }

    /* ---------------- 交互 ---------------- */
    onClick(e) {
      if (this.over) return;
      if (this.isNet ? this.turn !== this.mySide : this.turn === this.aiSide) return;
      const rect = this.canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left) / this.cw);
      const r = Math.floor((e.clientY - rect.top) / this.chh);
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      const v = this.board[idx(r, c)];

      if (this.sel) {
        const moves = this.movesFrom(this.board, this.sel[0], this.sel[1]);
        const m = moves.find(x => x.tr === r && x.tc === c);
        if (m) { this.doMove(m); if (this.isNet) this.opts.room.send({ t: 'mv', fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }); return; }
      }
      if (v && pside(v) === this.mySide) {
        this.sel = [r, c]; this.draw();
      } else if (v) {
        Snd.invalid(); this.opts.toast('那是对方的棋子');
      } else {
        this.sel = null; this.draw();
      }
    }

    doMove(m) {
      const target = this.board[idx(m.tr, m.tc)];
      const moved = this.board[idx(m.fr, m.fc)];
      this.board[idx(m.tr, m.tc)] = moved;
      this.board[idx(m.fr, m.fc)] = 0;
      this.sel = null;

      // 胜负判定
      const den = DEN[pside(moved) === TOP ? BOTTOM : TOP];
      let ended = false;
      if (den[0] === m.tc && den[1] === m.tr) {
        this.over = true; this.winner = pside(moved); ended = true;
      } else {
        // 棋子被吃光
        let t = 0, b = 0;
        for (const pv of this.board) { if (!pv) continue; if (pside(pv) === TOP) t++; else b++; }
        if (!t || !b) { this.over = true; this.winner = !t ? BOTTOM : TOP; ended = true; }
      }
      if (target) { Snd.capture(); this.pliesNoCap = 0; }
      else if (m.fr !== m.tr && isWater(m.fr, m.fc) !== isWater(m.tr, m.tc) && prank(moved) >= 6) Snd.jump();
      else { Snd.move(); this.pliesNoCap++; }

      if (!ended && this.pliesNoCap >= 80) { this.over = true; this.winner = 0; }
      this.turn = this.turn === TOP ? BOTTOM : TOP;
      this.draw();

      if (this.over) { this.finish(); return; }
      // 无棋可走的一方判负
      if (!this.allMoves(this.board, this.turn).length) {
        this.over = true; this.winner = this.turn === TOP ? BOTTOM : TOP;
        this.finish(); return;
      }
      this.updateStatus();
      if (!this.isNet && this.turn === this.aiSide) this.aiThink();
    }

    updateStatus() {
      const el = document.getElementById('ds-status'); if (!el) return;
      if (this.over) { el.textContent = '对局结束'; return; }
      const tName = this.turn === TOP ? '上方一方' : '下方一方';
      el.textContent = this.isNet
        ? (this.turn === this.mySide ? '轮到你（' + tName + '）行动' : '等待对方（' + tName + '）行动')
        : (this.turn === this.aiSide ? 'AI（' + tName + '）思考中…' : '轮到你（' + tName + '）行动');
    }

    finish() {
      const overlay = document.getElementById('ds-overlay');
      const res = document.getElementById('ds-result');
      let text;
      if (!this.winner) text = '和棋（80 步未分胜负）';
      else if (this.isNet) text = this.winner === this.mySide ? '你赢了！' : '你输了…';
      else text = this.winner === this.mySide ? '你赢了！' : 'AI 获胜';
      if (res) res.textContent = text;
      if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
      const iWon = this.winner && this.winner === this.mySide;
      if (this.winner) { if (iWon) Snd.win(); else Snd.lose(); }
      this.updateStatus();
    }

    reset() {
      const overlay = document.getElementById('ds-overlay');
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
        if (this.over) return;
        const moves = this.allMoves(this.board, this.turn);
        const m = moves.find(x => x.fr === msg.fr && x.fc === msg.fc && x.tr === msg.tr && x.tc === msg.tc);
        if (m) this.doMove(m);
      } else if (msg.t === 'again') {
        this.reset();
      }
    }

    /* ---------------- AI ---------------- */
    countSide(board, side) {
      let n = 0;
      for (const v of board) if (v && pside(v) === side) n++;
      return n;
    }

    /* 局势对 side 的静态评估 */
    evalSide(board, side) {
      const opp = side === TOP ? BOTTOM : TOP;
      let mat = 0, prog = 0, trap = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = board[idx(r, c)]; if (!v) continue;
        if (pside(v) === side) {
          mat += prank(v) * 12;
          prog += side === BOTTOM ? (8 - r) * 2 : r * 2;
          if (trapOwner(r, c) === opp) trap += 5;
        } else {
          mat -= prank(v) * 12;
          prog -= pside(v) === BOTTOM ? (8 - r) * 2 : r * 2;
          if (trapOwner(r, c) === side) trap -= 5;
        }
      }
      const mob = this.allMoves(board, side).length - this.allMoves(board, opp).length;
      return mat + prog + trap + mob * 0.6;
    }

    ab(board, depth, alpha, beta, side) {
      const opp = side === TOP ? BOTTOM : TOP;
      let moves = this.allMoves(board, side);
      if (!moves.length) return -900000 - depth;
      if (this.countSide(board, opp) === 0) return 900000 + depth;
      if (depth <= 0) return this.evalSide(board, side);
      moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
      for (const m of moves) {
        const nb = board.slice();
        nb[idx(m.tr, m.tc)] = nb[idx(m.fr, m.fc)];
        nb[idx(m.fr, m.fc)] = 0;
        const v = -this.ab(nb, depth - 1, -beta, -alpha, opp);
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return alpha;
    }

    aiThink() {
      if (this.dead || this.over) return;
      const side = this.turn;
      const moves = this.allMoves(this.board, side);
      if (!moves.length) return;
      this.updateStatus();
      this.timer = setTimeout(() => {
        if (this.dead) return;
        let pick;
        if (this.diff === 1) {
          pick = moves[Math.floor(Math.random() * moves.length)];
        } else if (this.diff === 2) {
          // 普通：一步贪心（进敌方兽穴/陷阱附近加权）
          let best = -Infinity;
          for (const m of moves) {
            const nb = this.board.slice();
            nb[idx(m.tr, m.tc)] = nb[idx(m.fr, m.fc)];
            nb[idx(m.fr, m.fc)] = 0;
            const v = this.evalSide(nb, side) + Math.random() * 5;
            if (v > best) { best = v; pick = m; }
          }
        } else {
          // 困难：Alpha-Beta 搜索 3 层，吃子走法优先
          let best = -Infinity;
          moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
          for (const m of moves) {
            const nb = this.board.slice();
            nb[idx(m.tr, m.tc)] = nb[idx(m.fr, m.fc)];
            nb[idx(m.fr, m.fc)] = 0;
            const v = -this.ab(nb, 2, -Infinity, Infinity, side === TOP ? BOTTOM : TOP);
            if (v > best) { best = v; pick = m; }
          }
        }
        if (pick) this.doMove(pick);
      }, this.diff === 3 ? 560 : 400);
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
  window.GG.doushou = {
    start(mount, opts) { this._inst = new Jungle(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
