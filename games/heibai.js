/* ==================================================================
 * 黑白棋（奥赛罗）模块：8×8
 *  AI：简单（随机）/ 普通（位置权重贪心）/ 困难（Alpha-Beta 多步搜索）
 *  联机：房主执黑先行，落子信令 {t:'mv',r,c}，再来一局 {t:'again'}
 * ================================================================== */
(function () {
  'use strict';
  const N = 8;
  const BLACK = 1, WHITE = 2;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  /* 位置权重表（角部极高，角旁危险） */
  const W = [
    [120, -20, 20, 5, 5, 20, -20, 120],
    [-20, -40, -5, -5, -5, -5, -40, -20],
    [20, -5, 3, 3, 3, 3, -5, 20],
    [5, -5, 3, 0, 0, 3, -5, 5],
    [5, -5, 3, 0, 0, 3, -5, 5],
    [20, -5, 3, 3, 3, 3, -5, 20],
    [-20, -40, -5, -5, -5, -5, -40, -20],
    [120, -20, 20, 5, 5, 20, -20, 120]
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
    place() { this.tone(300, 0.09, 'triangle', 0.14); },
    flip() { this.tone(520, 0.07, 'sine', 0.09, 0.05); },
    pass() { this.tone(200, 0.14, 'sine', 0.08); },
    win() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.13)); }
  };

  /* 返回 (r,c) 落子时能翻转的棋子坐标数组（空数组表示非法） */
  function flipsAt(board, r, c, side) {
    if (board[r * N + c] !== 0) return [];
    const opp = side === BLACK ? WHITE : BLACK, out = [];
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc; const line = [];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === opp) {
        line.push([rr, cc]); rr += dr; cc += dc;
      }
      if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === side) {
        line.forEach(p => out.push(p));
      }
    }
    return out;
  }

  function legalMoves(board, side) {
    const list = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const f = flipsAt(board, r, c, side);
      if (f.length) list.push({ r, c, f });
    }
    return list;
  }

  function countDiscs(board) {
    let b = 0, w = 0;
    for (const v of board) { if (v === BLACK) b++; else if (v === WHITE) w++; }
    return { b, w };
  }

  class Othello {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.myRole = opts.seat === 0 ? BLACK : WHITE;
      this.aiRole = this.isNet ? 0 : (this.myRole === BLACK ? WHITE : BLACK);
      this.diff = opts.diff || 2;
      this.unsubs = [];
      this.dead = false;
      this.timer = null;

      this.resetState();
      this.build();
      this.bindNet();
      this.draw();
      this.afterTurn(false);
    }

    resetState() {
      this.board = new Int8Array(N * N);
      this.board[3 * N + 3] = WHITE; this.board[3 * N + 4] = BLACK;
      this.board[4 * N + 3] = BLACK; this.board[4 * N + 4] = WHITE;
      this.turn = BLACK;
      this.over = false;
      this.winner = 0;
      this.passNote = '';
    }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="hb-status" class="text-xs sm:text-sm"></p>
          <p class="flex items-center gap-3 text-[11px] text-slate-400">
            <span><span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-500 align-middle mr-1"></span>黑 <b id="hb-bn" class="text-slate-200">2</b></span>
            <span><span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-100 align-middle mr-1"></span>白 <b id="hb-wn" class="text-slate-200">2</b></span>
          </p>
        </div>
        <div id="hb-boardwrap" class="relative mx-auto" style="max-width:520px">
          <canvas id="hb-canvas" class="block w-full rounded-xl cursor-pointer"></canvas>
          <div id="hb-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
               style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
            <div class="text-center px-6">
              <p id="hb-result" class="text-xl sm:text-2xl font-bold mb-1"></p>
              <p id="hb-resultsub" class="text-xs text-slate-400 mb-4"></p>
              <button id="hb-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
            </div>
          </div>
        </div>`;
      this.mount.appendChild(wrap);
      this.canvas = wrap.querySelector('#hb-canvas');
      this._resize = () => this.resize();
      window.addEventListener('resize', this._resize);
      this.resize();

      this.canvas.addEventListener('click', e => this.onClick(e));
      wrap.querySelector('#hb-again').addEventListener('click', () => {
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
      this.cs = w / N;
      this.draw();
    }

    draw() {
      const cv = this.canvas; if (!cv) return;
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = cv.width / dpr, cs = this.cs || w / N;

      // 棋盘底
      ctx.fillStyle = '#1f7a4d';
      ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = 'rgba(235,255,245,.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, w); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(w, i * cs); ctx.stroke();
      }

      // 合法落子提示（仅当前可由人操作的回合）
      const humanTurn = this.isNet ? this.turn === this.myRole : this.turn !== this.aiRole;
      if (humanTurn && !this.over) {
        const moves = legalMoves(this.board, this.turn);
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        moves.forEach(m => {
          ctx.beginPath();
          ctx.arc((m.c + 0.5) * cs, (m.r + 0.5) * cs, cs * 0.11, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // 棋子
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = this.board[r * N + c]; if (!v) continue;
        const x = (c + 0.5) * cs, y = (r + 0.5) * cs, rad = cs * 0.38;
        const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
        if (v === BLACK) { g.addColorStop(0, '#5b6472'); g.addColorStop(1, '#0b0f17'); }
        else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c7d0dc'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }

      const cnt = countDiscs(this.board);
      const bn = document.getElementById('hb-bn'), wn = document.getElementById('hb-wn');
      if (bn) bn.textContent = cnt.b;
      if (wn) wn.textContent = cnt.w;
    }

    /* ---------------- 交互与流程 ---------------- */
    onClick(e) {
      if (this.over) return;
      if (this.isNet ? this.turn !== this.myRole : this.turn === this.aiRole) return;
      const rect = this.canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left) / this.cs);
      const r = Math.floor((e.clientY - rect.top) / this.cs);
      if (r < 0 || r >= N || c < 0 || c >= N) return;
      const f = flipsAt(this.board, r, c, this.turn);
      if (!f.length) { this.opts.toast('该位置不能落子'); return; }
      this.apply(r, c, f);
      if (this.isNet) this.opts.room.send({ t: 'mv', r, c });
    }

    apply(r, c, f) {
      const side = this.turn;
      this.board[r * N + c] = side;
      f.forEach(p => { this.board[p[0] * N + p[1]] = side; });
      Snd.place();
      if (f.length > 1) setTimeout(() => Snd.flip(), 40);
      this.turn = side === BLACK ? WHITE : BLACK;
      this.draw();
      this.afterTurn(true);
    }

    /* 处理跳过、终局与 AI 调度 */
    afterTurn(soundPass) {
      if (this.over) return;
      if (!legalMoves(this.board, this.turn).length) {
        const other = this.turn === BLACK ? WHITE : BLACK;
        if (!legalMoves(this.board, other).length) { this.finish(); return; }
        this.passNote = (this.turn === BLACK ? '黑方' : '白方') + '无棋可下，自动跳过';
        if (soundPass) Snd.pass();
        this.turn = other;
        this.draw();
      } else {
        this.passNote = '';
      }
      this.updateStatus();
      if (this.over) return;
      if (!this.isNet && this.turn === this.aiRole) this.aiThink();
    }

    updateStatus() {
      const el = document.getElementById('hb-status'); if (!el) return;
      if (this.over) { el.textContent = '对局结束'; return; }
      const tName = this.turn === BLACK ? '黑方' : '白方';
      const who = this.isNet
        ? (this.turn === this.myRole ? '轮到你（' + tName + '）落子' : '等待对方（' + tName + '）落子')
        : (this.turn === this.aiRole ? 'AI（' + tName + '）思考中…' : '轮到你（' + tName + '）落子');
      el.textContent = (this.passNote ? this.passNote + '；' : '') + who;
    }

    finish() {
      this.over = true;
      const cnt = countDiscs(this.board);
      let winSide = cnt.b === cnt.w ? 0 : (cnt.b > cnt.w ? BLACK : WHITE);
      this.winner = winSide;
      const overlay = document.getElementById('hb-overlay');
      const res = document.getElementById('hb-result');
      const sub = document.getElementById('hb-resultsub');
      let text;
      if (!winSide) text = '平局！';
      else if (this.isNet) text = winSide === this.myRole ? '你赢了！' : '你输了…';
      else text = winSide === this.myRole ? '你赢了！' : 'AI 获胜';
      if (res) res.textContent = text;
      if (sub) sub.textContent = '黑 ' + cnt.b + ' : ' + cnt.w + ' 白';
      if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
      const iWon = winSide && (winSide === this.myRole);
      if (winSide) { if (iWon) Snd.win(); else Snd.lose(); }
      this.updateStatus();
    }

    reset() {
      const overlay = document.getElementById('hb-overlay');
      if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('flex'); }
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.resetState();
      this.draw();
      this.afterTurn(false);
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
        if (this.over || msg.r == null) return;
        const f = flipsAt(this.board, msg.r, msg.c, this.turn);
        if (f.length) this.apply(msg.r, msg.c, f);
      } else if (msg.t === 'again') {
        this.reset();
      }
    }

    /* ---------------- AI ---------------- */
    /* 静态评估：返回局势对 side 的有利度 */
    evalSide(board, side) {
      const opp = side === BLACK ? WHITE : BLACK;
      let pos = 0, empty = 0, sc = 0, so = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = board[r * N + c];
        if (!v) { empty++; continue; }
        if (v === side) { pos += W[r][c]; sc++; } else { pos -= W[r][c]; so++; }
      }
      const mc = legalMoves(board, side).length;
      const mo = legalMoves(board, opp).length;
      let score = pos * 1.2 + (mc - mo) * 8;
      // 残局（空格 ≤ 12）转为棋子数评估
      if (empty <= 12) score += (sc - so) * 220;
      return score;
    }

    ab(board, depth, alpha, beta, side) {
      const opp = side === BLACK ? WHITE : BLACK;
      const moves = legalMoves(board, side);
      if (!moves.length) {
        if (!legalMoves(board, opp).length) {
          const c = countDiscs(board);
          const mine = side === BLACK ? c.b : c.w, his = side === BLACK ? c.w : c.b;
          return mine > his ? 900000 + depth : mine < his ? -900000 - depth : 0;
        }
        return -this.ab(board, depth - 1, -beta, -alpha, opp);
      }
      if (depth <= 0) return this.evalSide(board, side);
      // 先走能翻得多的位置，提高剪枝效率
      moves.sort((a, b) => b.f.length - a.f.length);
      for (const m of moves) {
        const nb = board.slice();
        nb[m.r * N + m.c] = side;
        m.f.forEach(p => { nb[p[0] * N + p[1]] = side; });
        const v = -this.ab(nb, depth - 1, -beta, -alpha, opp);
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return alpha;
    }

    aiThink() {
      if (this.dead || this.over) return;
      const side = this.turn;
      const moves = legalMoves(this.board, side);
      if (!moves.length) { this.afterTurn(true); return; }
      this.updateStatus();
      this.timer = setTimeout(() => {
        if (this.dead) return;
        let pick;
        if (this.diff === 1) {
          // 简单：随机
          pick = moves[Math.floor(Math.random() * moves.length)];
        } else if (this.diff === 2) {
          // 普通：位置权重 + 当回合翻转收益，一步贪心
          let best = -Infinity;
          moves.forEach(m => {
            const v = W[m.r][m.c] * 2 + m.f.length * 1.5 + Math.random() * 6;
            if (v > best) { best = v; pick = m; }
          });
        } else {
          // 困难：Alpha-Beta 搜索 5 层
          let best = -Infinity;
          moves.sort((a, b) => b.f.length - a.f.length);
          for (const m of moves) {
            const nb = this.board.slice();
            nb[m.r * N + m.c] = side;
            m.f.forEach(p => { nb[p[0] * N + p[1]] = side; });
            const v = -this.ab(nb, 4, -Infinity, Infinity, side === BLACK ? WHITE : BLACK);
            if (v > best) { best = v; pick = m; }
          }
        }
        if (pick) this.apply(pick.r, pick.c, pick.f);
      }, this.diff === 3 ? 520 : 380);
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
  window.GG.heibai = {
    start(mount, opts) { this._inst = new Othello(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
