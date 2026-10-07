/* ==================================================================
 * 五子棋模块：15 路棋盘
 *  AI：简单（随机邻点）/ 中等（启发式评估）/ 困难（Alpha-Beta 负极大值搜索）
 *  联机：房主执黑，落子信令 {t:'mv',r,c}，再来一局 {t:'again'}
 * ================================================================== */
(function () {
  'use strict';
  const N = 15;
  const BLACK = 1, WHITE = 2;

  const DIR4 = [[0, 1], [1, 0], [1, 1], [1, -1]];

  /* 棋形分值 */
  const P_FOUR_L = 50000;
  const P_FOUR   = 4000;
  const P_THREE_L = 2500;
  const P_THREE   = 450;
  const P_TWO_L   = 120;
  const P_TWO     = 30;
  const WIN_SCORE = 1000000;

  const RE_FOUR = ['011112', '211110', '11011', '10111', '11101'];
  const RE_THREE_L = ['011100', '001110', '011010', '010110'];
  const RE_THREE = ['001112', '211100', '010112', '211010', '011012', '210110',
                    '10011', '11001', '10101'];
  const RE_TWO_L = ['001100', '011000', '000110', '010100', '001010', '010010'];
  const RE_TWO = ['001102', '201100', '1001'];

  function dirScore(s) {
    if (s.indexOf('11111') >= 0) return WIN_SCORE;
    if (s.indexOf('011110') >= 0) return P_FOUR_L;
    if (RE_FOUR.some(p => s.indexOf(p) >= 0)) return P_FOUR;
    if (RE_THREE_L.some(p => s.indexOf(p) >= 0)) return P_THREE_L;
    if (RE_THREE.some(p => s.indexOf(p) >= 0)) return P_THREE;
    if (RE_TWO_L.some(p => s.indexOf(p) >= 0)) return P_TWO_L;
    if (RE_TWO.some(p => s.indexOf(p) >= 0)) return P_TWO;
    return 0;
  }

  class Gomoku {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.myRole = this.isNet ? (opts.seat === 0 ? BLACK : WHITE) : (opts.seat === 0 ? BLACK : WHITE);
      this.aiRole = this.isNet ? 0 : (this.myRole === BLACK ? WHITE : BLACK);
      this.diff = opts.diff || 2;
      this.unsubs = [];
      this.dead = false;
      this.hover = null;

      this.board = new Int8Array(N * N);
      this.history = [];
      this.turn = BLACK;
      this.over = false;
      this.winner = 0;

      this.build();
      this.bindNet();
      this.draw();
      if (!this.isNet && this.turn === this.aiRole) this.aiThink();
    }

    /* ---------------- UI 构建 ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="gk-status" class="text-xs sm:text-sm"></p>
          <p class="text-[11px] text-slate-500"><i class="fa-solid fa-hourglass-half mr-1"></i><span id="gk-moves">0</span> 手</p>
        </div>
        <div id="gk-boardwrap" class="relative mx-auto" style="max-width:560px">
          <canvas id="gk-canvas" class="block w-full rounded-xl"></canvas>
          <div id="gk-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
               style="background:rgba(2,6,23,.7);backdrop-filter:blur(3px)">
            <div class="text-center px-6">
              <p id="gk-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
              <button id="gk-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-center gap-2 mt-4 flex-wrap">
          <button id="gk-restart" class="btn-ghost"><i class="fa-solid fa-rotate-right"></i>重新开局</button>
          ${this.isNet ? '' : '<button id="gk-undo" class="btn-ghost"><i class="fa-solid fa-rotate-left"></i>悔棋</button>'}
        </div>`;
      this.mount.appendChild(wrap);

      this.canvas = wrap.querySelector('#gk-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.sizeCanvas();

      wrap.querySelector('#gk-restart').addEventListener('click', () => {
        if (this.isNet) {
          if (!this.over) { this.opts.toast('对局结束后才能重新开局'); return; }
          this.opts.room.send({ t: 'again' });
          this.reset();
        } else { this.reset(); }
      });
      wrap.querySelector('#gk-again').addEventListener('click', () => {
        if (this.isNet) { this.opts.room.send({ t: 'again' }); this.reset(); }
        else this.reset();
      });
      const undoBtn = wrap.querySelector('#gk-undo');
      if (undoBtn) undoBtn.addEventListener('click', () => this.undo());

      this.canvas.addEventListener('click', e => this.onClick(e));
      this.canvas.addEventListener('mousemove', e => this.onHover(e));
      this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
      window.addEventListener('resize', this._resize = () => { this.sizeCanvas(); this.draw(); });
    }

    sizeCanvas() {
      const w = this.canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      this.W = w;
      this.canvas.style.height = w + 'px';
      // backing 宽高必须同时设置，否则 width 停留在默认 300：
      // 高 DPR 手机上棋盘右侧被裁切、边缘棋子绘制丢失（只显示点位）
      this.canvas.width = w * dpr;
      this.canvas.height = w * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.pad = w * 0.04;
      this.cell = (w - this.pad * 2) / (N - 1);
    }

    /* ---------------- 绘制 ---------------- */
    draw() {
      const ctx = this.ctx, W = this.W, pad = this.pad, cell = this.cell;
      ctx.clearRect(0, 0, W, W);
      ctx.fillStyle = 'rgba(15,23,42,.55)';
      ctx.fillRect(0, 0, W, W);

      ctx.strokeStyle = 'rgba(148,197,255,.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const p = pad + i * cell;
        ctx.moveTo(pad, p); ctx.lineTo(W - pad, p);
        ctx.moveTo(p, pad); ctx.lineTo(p, W - pad);
      }
      ctx.stroke();

      // 星位
      ctx.fillStyle = 'rgba(103,232,249,.75)';
      [[3,3],[3,11],[11,3],[11,11],[7,7]].forEach(([r,c]) => {
        ctx.beginPath();
        ctx.arc(pad + c * cell, pad + r * cell, 3.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // 悬停预览
      if (this.hover && !this.over && this.board[this.hover.r * N + this.hover.c] === 0
          && this.canAct()) {
        this.drawStone(this.hover.r, this.hover.c, this.turn, .35);
      }

      // 棋子
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = this.board[r * N + c];
          if (v) this.drawStone(r, c, v, 1);
        }
      }

      // 最后一手标记
      const last = this.history[this.history.length - 1];
      if (last) {
        const x = pad + last.c * cell, y = pad + last.r * cell;
        ctx.strokeStyle = last.role === BLACK ? '#67e8f9' : '#f87171';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, cell * .18, 0, Math.PI * 2);
        ctx.stroke();
      }

      this.updateStatus();
    }

    drawStone(r, c, role, alpha) {
      const ctx = this.ctx;
      const x = this.pad + c * this.cell, y = this.pad + r * this.cell;
      const rad = this.cell * .43;
      ctx.save();
      ctx.globalAlpha = alpha;
      const g = ctx.createRadialGradient(x - rad * .35, y - rad * .35, rad * .15, x, y, rad);
      if (role === BLACK) { g.addColorStop(0, '#475569'); g.addColorStop(1, '#020617'); }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cbd5e1'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      // 轮廓线：黑棋浅边、白棋深边，任何屏幕上棋子都清晰可辨
      ctx.lineWidth = Math.max(1, this.cell * .05);
      ctx.strokeStyle = role === BLACK ? 'rgba(226,232,240,.6)' : 'rgba(71,85,105,.85)';
      ctx.beginPath(); ctx.arc(x, y, rad - ctx.lineWidth * .5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    updateStatus() {
      const el = this.mount.querySelector('#gk-status');
      if (!el) return;
      if (this.over) {
        el.innerHTML = this.winner === 0
          ? '<span class="text-slate-300">平局</span>'
          : `<span class="${this.winner === BLACK ? 'text-slate-100' : 'text-slate-100'}">${this.winner === BLACK ? '黑棋' : '白棋'}获胜</span>`;
      } else {
        const roleTxt = this.turn === BLACK ? '黑棋' : '白棋';
        let suffix = '';
        if (this.isNet) suffix = this.turn === this.myRole ? ' · 轮到你落子' : ' · 等待对方…';
        else suffix = this.turn === this.aiRole ? ' · AI 思考中…' : '';
        el.innerHTML = `<i class="fa-solid fa-circle ${this.turn === BLACK ? 'text-slate-100' : 'text-slate-300'} mr-1 text-[9px]"></i>${roleTxt}回合${suffix}`;
      }
      this.mount.querySelector('#gk-moves').textContent = this.history.length;
    }

    /* ---------------- 交互 ---------------- */
    eventCell(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const c = Math.round((x - this.pad) / this.cell);
      const r = Math.round((y - this.pad) / this.cell);
      if (r < 0 || r >= N || c < 0 || c >= N) return null;
      return { r, c };
    }
    onClick(e) {
      if (this.over || !this.canAct()) return;
      const cell = this.eventCell(e);
      if (!cell) return;
      if (this.board[cell.r * N + cell.c] !== 0) return;
      if (this.isNet) this.opts.room.send({ t: 'mv', r: cell.r, c: cell.c });
      this.place(cell.r, cell.c, this.turn);
    }
    onHover(e) {
      const cell = this.eventCell(e);
      this.hover = cell;
      this.draw();
    }

    canAct() {
      if (this.dead) return false;
      if (this.isNet) return this.turn === this.myRole;
      return this.turn !== this.aiRole;
    }

    place(r, c, role) {
      this.board[r * N + c] = role;
      this.history.push({ r, c, role });
      if (this.checkWin(r, c, role)) {
        this.over = true; this.winner = role;
        this.draw(); this.showResult();
        return;
      }
      if (this.history.length >= N * N) {
        this.over = true; this.winner = 0;
        this.draw(); this.showResult();
        return;
      }
      this.turn = role === BLACK ? WHITE : BLACK;
      this.draw();
      if (!this.isNet && this.turn === this.aiRole && !this.over) this.aiThink();
    }

    checkWin(r, c, role) {
      for (const [dr, dc] of DIR4) {
        let cnt = 1;
        for (const s of [1, -1]) {
          let rr = r + dr * s, cc = c + dc * s;
          while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === role) {
            cnt++; rr += dr * s; cc += dc * s;
          }
        }
        if (cnt >= 5) return true;
      }
      return false;
    }

    showResult() {
      const ov = this.mount.querySelector('#gk-overlay');
      const txt = this.mount.querySelector('#gk-result');
      if (this.winner === 0) txt.textContent = '平 局';
      else {
        const winTxt = this.winner === BLACK ? '黑棋获胜' : '白棋获胜';
        txt.textContent = winTxt;
        txt.className = 'text-xl sm:text-2xl font-bold mb-4 ' + (this.isNet
          ? (this.winner === this.myRole ? 'text-green-400' : 'text-rose-400')
          : 'text-cyan-300');
      }
      ov.classList.remove('hidden');
      ov.classList.add('flex');
    }

    reset() {
      this.board = new Int8Array(N * N);
      this.history = [];
      this.turn = BLACK;
      this.over = false;
      this.winner = 0;
      this.hover = null;
      const ov = this.mount.querySelector('#gk-overlay');
      ov.classList.add('hidden'); ov.classList.remove('flex');
      this.draw();
      if (!this.isNet && this.turn === this.aiRole) this.aiThink();
    }

    undo() {
      if (this.isNet || this.over) return;
      // 回退到玩家可以重新行棋：最多撤回两手
      let pops = 0;
      while (this.history.length && pops < 2) {
        const h = this.history.pop();
        this.board[h.r * N + h.c] = 0;
        this.turn = h.role;
        pops++;
        if (h.role === this.myRole) break;
      }
      this.draw();
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
        if (this.over || this.board[msg.r * N + msg.c] !== 0) return;
        this.place(msg.r, msg.c, this.turn);
      } else if (msg.t === 'again') {
        this.reset();
      }
    }

    /* ---------------- AI ---------------- */
    evalAt(r, c, role) {
      let total = 0;
      for (const [dr, dc] of DIR4) {
        let s = '';
        for (let k = -4; k <= 4; k++) {
          if (k === 0) { s += '1'; continue; }
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) { s += '2'; continue; }
          const v = this.board[rr * N + cc];
          s += v === 0 ? '0' : (v === role ? '1' : '2');
        }
        const ds = dirScore(s);
        if (ds >= WIN_SCORE) return WIN_SCORE;
        total += ds;
      }
      return total;
    }

    candidates(radius) {
      const set = new Set();
      let hasStone = false;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (this.board[r * N + c] !== 0) {
            hasStone = true;
            for (let dr = -radius; dr <= radius; dr++) {
              for (let dc = -radius; dc <= radius; dc++) {
                const rr = r + dr, cc = c + dc;
                if (rr >= 0 && rr < N && cc >= 0 && cc < N && this.board[rr * N + cc] === 0) {
                  set.add(rr * N + cc);
                }
              }
            }
          }
        }
      }
      if (!hasStone) return [7 * N + 7];
      return Array.from(set);
    }

    rankedCandidates(role, limit) {
      const opp = role === BLACK ? WHITE : BLACK;
      const list = this.candidates(1).map(idx => {
        const r = Math.floor(idx / N), c = idx % N;
        return { idx, r, c, v: this.evalAt(r, c, role) + this.evalAt(r, c, opp) * .85 };
      });
      list.sort((a, b) => b.v - a.v);
      return limit ? list.slice(0, limit) : list;
    }

    aiThink() {
      setTimeout(() => {
        if (this.dead || this.over || this.turn !== this.aiRole) return;
        let mv;
        if (this.diff === 1) mv = this.aiEasy();
        else if (this.diff === 2) mv = this.aiMedium();
        else mv = this.aiHard();
        if (mv) this.place(mv.r, mv.c, this.aiRole);
      }, 260);
    }

    aiEasy() {
      const cands = this.candidates(1);
      const pick = cands[Math.floor(Math.random() * cands.length)];
      return { r: Math.floor(pick / N), c: pick % N };
    }

    aiMedium() {
      const role = this.aiRole, opp = role === BLACK ? WHITE : BLACK;
      // 自己能成五立刻落子；对方有成五点必须封堵
      let win = null, block = null;
      const cands = this.candidates(1);
      let best = null;
      for (const idx of cands) {
        const r = Math.floor(idx / N), c = idx % N;
        const atk = this.evalAt(r, c, role);
        if (atk >= WIN_SCORE) { win = { r, c }; break; }
        const def = this.evalAt(r, c, opp);
        if (def >= WIN_SCORE) block = { r, c };
        const v = atk + def * .9;
        if (!best || v > best.v) best = { r, c, v };
      }
      if (win) return win;
      if (block) return block;
      return best;
    }

    aiHard() {
      const role = this.aiRole;
      // 战术：立即成五 / 堵五 / 活四处理
      const tactical = this.aiMedium();
      const ranked = this.rankedCandidates(role, 10);
      if (ranked.length && ranked[0].v >= WIN_SCORE) return tactical;

      const depth = window.innerWidth < 640 ? 2 : 4;
      let best = null, alpha = -Infinity;
      const beta = Infinity;
      for (const cand of ranked) {
        const { r, c } = cand;
        this.board[r * N + c] = role;
        this.history.push({ r, c, role });
        let s;
        if (this.checkWin(r, c, role)) s = WIN_SCORE - this.history.length;
        else s = -this.search(depth - 1, -beta, -alpha, role === BLACK ? WHITE : BLACK);
        this.history.pop();
        this.board[r * N + c] = 0;
        if (s > alpha) { alpha = s; best = { r, c }; }
      }
      return best || tactical;
    }

    /* 负极大值：返回当前行棋方视角的评分 */
    search(depth, alpha, beta, role) {
      const ranked = this.rankedCandidates(role, 8);
      if (depth <= 0 || ranked.length === 0) {
        // 叶子：以当前最佳点的己方棋形作为该方收益
        const top = ranked[0];
        return top ? this.evalAt(top.r, top.c, role) : 0;
      }
      const opp = role === BLACK ? WHITE : BLACK;
      let best = -Infinity;
      for (const cand of ranked) {
        const { r, c } = cand;
        this.board[r * N + c] = role;
        this.history.push({ r, c, role });
        let s;
        if (this.checkWin(r, c, role)) s = WIN_SCORE - this.history.length;
        else s = -this.search(depth - 1, -beta, -alpha, opp);
        this.history.pop();
        this.board[r * N + c] = 0;
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
      return best;
    }

    stop() {
      this.dead = true;
      this.unsubs.forEach(un => { try { un(); } catch (e) {} });
      window.removeEventListener('resize', this._resize);
      this.mount.innerHTML = '';
    }
  }

  window.GG = window.GG || {};
  window.GG.gomoku = {
    start(mount, opts) { this._inst = new Gomoku(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
