/* ==================================================================
 * 中国象棋模块：9×10 棋盘
 *  全规则：帥將 / 仕士 / 相象（塞象眼、不过河）/ 馬（蹩腿）/ 車 / 炮（隔山打）/ 兵卒
 *  将死、困毙判负；将帅照面非法
 *  AI：简单随机 / 中等贪心 / 困难 Alpha-Beta
 *  联机：房主执红，信令 {t:'mv',fr,to}，再来一局 {t:'again'}
 * ================================================================== */
(function () {
  'use strict';

  const COLS = 9, ROWS = 10;
  const IDX = (r, c) => r * COLS + c;

  /* 初始阵形：黑在上（小写）红在下（大写）；炮在 1、7 路，兵卒在 0、2、4、6、8 路 */
  const INIT = [
    'rnbakabnr',
    '.........',
    '.c.....c.',
    'p.p.p.p.p',
    '.........',
    '.........',
    'P.P.P.P.P',
    '.C.....C.',
    '.........',
    'RNBAKABNR'
  ].join('');

  const VALUES = { K: 10000, R: 90, C: 45, N: 40, A: 20, B: 20, P: 10 };

  function isRedCh(ch) { return ch >= 'A' && ch <= 'Z'; }

  class Xiangqi {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      // 视角方（自己）：联机房主红 / AI 模式按座位
      this.myRed = this.isNet ? opts.seat === 0 : opts.seat === 0;
      this.aiRed = this.isNet ? null : !this.myRed;
      this.diff = opts.diff || 2;

      this.board = INIT.split('');
      this.redTurn = true;
      this.over = false;
      this.winner = '';   // 'red' | 'black'
      this.selected = null;
      this.targets = [];
      this.lastMove = null;
      this.unsubs = [];
      this.dead = false;

      this.build();
      this.bindNet();
      this.draw();
      if (!this.isNet && this.aiRed === this.redTurn) this.aiThink();
    }

    /* ---------------- 走法生成 ---------------- */
    inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

    genPseudo(red) {
      const list = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.board[IDX(r, c)];
          if (!ch || ch === '.') continue;
          if (isRedCh(ch) !== red) continue;
          this.pieceMoves(r, c, ch, list);
        }
      }
      return list;
    }

    addMove(list, fr, r, c) {
      if (!this.inBoard(r, c)) return;
      const t = this.board[IDX(r, c)];
      if (!t || t === '.') { list.push([fr, [r, c], '']); return; }
      if (isRedCh(t) !== isRedCh(this.board[IDX(fr[0], fr[1])])) {
        list.push([fr, [r, c], t]);
      }
    }

    pieceMoves(r, c, ch, list) {
      const red = isRedCh(ch);
      const type = ch.toUpperCase();
      const fr = [r, c];
      const add = (rr, cc) => this.addMove(list, fr, rr, cc);

      if (type === 'K') {
        const r1 = red ? r - 1 : r + 1, r2 = red ? r + 1 : r - 1;
        add(r1, c); add(r2, c); add(r, c - 1); add(r, c + 1);
      } else if (type === 'A') {
        add(r - 1, c - 1); add(r - 1, c + 1); add(r + 1, c - 1); add(r + 1, c + 1);
      } else if (type === 'B') {
        const steps = [[-2,-2],[-2,2],[2,-2],[2,2]];
        for (const [dr, dc] of steps) {
          const rr = r + dr, cc = c + dc;
          if (!this.inBoard(rr, cc)) continue;
          if (red && rr < 5) continue;       // 不过河
          if (!red && rr > 4) continue;
          if (this.board[IDX(r + dr / 2, c + dc / 2)] !== '.') continue;  // 塞象眼
          add(rr, cc);
        }
      } else if (type === 'N') {
        const steps = [
          [-2,-1, -1,0],[-2,1, -1,0],[2,-1, 1,0],[2,1, 1,0],
          [-1,-2, 0,-1],[1,-2, 0,-1],[-1,2, 0,1],[1,2, 0,1]
        ];
        for (const [dr, dc, lr, lc] of steps) {
          if (this.board[IDX(r + lr, c + lc)] !== '.') continue;  // 蹩马腿
          add(r + dr, c + dc);
        }
      } else if (type === 'R') {
        [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => {
          let rr = r + dr, cc = c + dc;
          while (this.inBoard(rr, cc)) {
            const t = this.board[IDX(rr, cc)];
            if (t === '.') { list.push([fr, [rr, cc], '']); }
            else { if (isRedCh(t) !== red) list.push([fr, [rr, cc], t]); break; }
            rr += dr; cc += dc;
          }
        });
      } else if (type === 'C') {
        [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => {
          let rr = r + dr, cc = c + dc;
          let jumped = false;
          while (this.inBoard(rr, cc)) {
            const t = this.board[IDX(rr, cc)];
            if (!jumped) {
              if (t === '.') list.push([fr, [rr, cc], '']);
              else jumped = true;
            } else {
              if (t !== '.') { if (isRedCh(t) !== red) list.push([fr, [rr, cc], t]); break; }
            }
            rr += dr; cc += dc;
          }
        });
      } else if (type === 'P') {
        add(red ? r - 1 : r + 1, c);
        const crossed = red ? r <= 4 : r >= 5;
        if (crossed) { add(r, c - 1); add(r, c + 1); }
      }
    }

    findKing(red) {
      const k = red ? 'K' : 'k';
      for (let i = 0; i < this.board.length; i++) {
        if (this.board[i] === k) return [Math.floor(i / COLS), i % COLS];
      }
      return null;
    }

    kingsFacing() {
      const rk = this.findKing(true), bk = this.findKing(false);
      if (!rk || !bk || rk[1] !== bk[1]) return false;
      const c = rk[1];
      for (let r = bk[0] + 1; r < rk[0]; r++) {
        if (this.board[IDX(r, c)] !== '.') return false;
      }
      return true;
    }

    /* 走完后己方是否安全（王存在、不照面、王不被攻击） */
    kingSafe(red) {
      const k = this.findKing(red);
      if (!k) return false;
      if (this.kingsFacing()) return false;
      const enemy = this.genPseudo(!red);
      for (const m of enemy) {
        if (m[1][0] === k[0] && m[1][1] === k[1]) return false;
      }
      return true;
    }

    genLegal(red) {
      const pseudo = this.genPseudo(red);
      const out = [];
      for (const m of pseudo) {
        const [fr, to] = m;
        const cap = this.board[IDX(to[0], to[1])];
        this.board[IDX(to[0], to[1])] = this.board[IDX(fr[0], fr[1])];
        this.board[IDX(fr[0], fr[1])] = '.';
        if (this.kingSafe(red)) out.push(m);
        this.board[IDX(fr[0], fr[1])] = this.board[IDX(to[0], to[1])];
        this.board[IDX(to[0], to[1])] = cap;
      }
      return out;
    }

    inCheck(red) {
      const k = this.findKing(red);
      if (!k) return false;
      const enemy = this.genPseudo(!red);
      return enemy.some(m => m[1][0] === k[0] && m[1][1] === k[1]);
    }

    /* ---------------- UI ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="xq-status" class="text-xs sm:text-sm"></p>
          <p id="xq-check" class="text-[11px] font-semibold text-rose-400"></p>
        </div>
        <div id="xq-boardwrap" class="relative mx-auto" style="max-width:520px">
          <canvas id="xq-canvas" class="block w-full rounded-xl"></canvas>
          <div id="xq-overlay" class="hidden absolute inset-0 rounded-xl items-center justify-center"
               style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
            <div class="text-center px-6">
              <p id="xq-result" class="text-xl sm:text-2xl font-bold mb-4"></p>
              <button id="xq-again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-center gap-2 mt-4 flex-wrap">
          <button id="xq-restart" class="btn-ghost"><i class="fa-solid fa-rotate-right"></i>重新开局</button>
        </div>`;
      this.mount.appendChild(wrap);

      this.canvas = wrap.querySelector('#xq-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.sizeCanvas();

      wrap.querySelector('#xq-restart').addEventListener('click', () => this.requestRestart());
      wrap.querySelector('#xq-again').addEventListener('click', () => this.requestRestart());
      this.canvas.addEventListener('click', e => this.onClick(e));
      window.addEventListener('resize', this._resize = () => { this.sizeCanvas(); this.draw(); });
    }

    requestRestart() {
      if (this.isNet) {
        if (!this.over) { this.opts.toast('对局结束后才能重新开局'); return; }
        this.opts.room.send({ t: 'again' });
      }
      this.reset();
    }

    sizeCanvas() {
      const w = this.canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      this.W = w;
      // 边距必须 >= 边缘棋子半径，保证車/馬/炮等边子完整不被 canvas 边缘裁切；
      // 棋子半径 = cw*.42 ≈ .0464w，取 pad=.058w 留足描边安全量
      this.pad = w * 0.058;
      this.cw = (w - this.pad * 2) / 8;
      this.H = this.pad * 2 + this.cw * 9;
      this.canvas.style.height = this.H + 'px';
      // backing 宽高必须同时设置，否则 width 停留默认 300，高 DPR 手机上
      // 棋盘右侧数列与棋子被整段裁切
      this.canvas.width = w * dpr;
      this.canvas.height = this.H * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* 视角翻转：自己一方始终在棋盘下方 */
    viewOf(r, c) {
      return this.myRed ? [r, c] : [ROWS - 1 - r, COLS - 1 - c];
    }
    boardOf(vr, vc) {
      return this.myRed ? [vr, vc] : [ROWS - 1 - vr, COLS - 1 - vc];
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.W, this.H);
      ctx.fillStyle = 'rgba(15,23,42,.6)';
      ctx.fillRect(0, 0, this.W, this.H);

      const p = this.pad, cw = this.cw;
      const X = c => p + c * cw;
      const Y = r => p + r * cw;

      // 横线
      ctx.strokeStyle = 'rgba(148,197,255,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r < ROWS; r++) { ctx.moveTo(X(0), Y(r)); ctx.lineTo(X(8), Y(r)); }
      // 竖线：中间七路贯通；两边两路在河界处断开
      for (let c = 1; c <= 7; c++) { ctx.moveTo(X(c), Y(0)); ctx.lineTo(X(c), Y(9)); }
      ctx.stroke();

      ctx.beginPath();
      [0, 8].forEach(c => {
        ctx.moveTo(X(c), Y(0)); ctx.lineTo(X(c), Y(4));
        ctx.moveTo(X(c), Y(5)); ctx.lineTo(X(c), Y(9));
      });
      ctx.stroke();

      // 九宫斜线（上下各一）
      ctx.beginPath();
      ctx.moveTo(X(3), Y(0)); ctx.lineTo(X(5), Y(2));
      ctx.moveTo(X(5), Y(0)); ctx.lineTo(X(3), Y(2));
      ctx.moveTo(X(3), Y(7)); ctx.lineTo(X(5), Y(9));
      ctx.moveTo(X(5), Y(7)); ctx.lineTo(X(3), Y(9));
      ctx.stroke();

      // 楚河汉界
      ctx.fillStyle = 'rgba(148,197,255,.6)';
      ctx.font = `${cw * .42}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const midY = (Y(4) + Y(5)) / 2;
      ctx.fillText('楚 河', X(2.2), midY);
      ctx.fillText('漢 界', X(5.8), midY);

      // 上一步标记
      if (this.lastMove) {
        const [fr, to] = this.lastMove;
        [fr, to].forEach(([r, c]) => {
          const [vr, vc] = this.viewOf(r, c);
          ctx.strokeStyle = 'rgba(103,232,249,.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(X(vc) - cw * .36, Y(vr) - cw * .36, cw * .72, cw * .72);
        });
      }

      // 棋子
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.board[IDX(r, c)];
          if (ch && ch !== '.') {
            const [vr, vc] = this.viewOf(r, c);
            this.drawPiece(ch, X(vc), Y(vr));
          }
        }
      }

      // 选中框 + 可走点
      if (this.selected) {
        const [vr, vc] = this.viewOf(this.selected[0], this.selected[1]);
        ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(vc), Y(vr), cw * .44, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(103,232,249,.55)';
        this.targets.forEach(([fr, to]) => {
          const [tr, tc] = this.viewOf(to[0], to[1]);
          ctx.beginPath(); ctx.arc(X(tc), Y(tr), cw * .12, 0, Math.PI * 2); ctx.fill();
        });
      }

      this.updateStatus();
    }

    drawPiece(ch, x, y) {
      const ctx = this.ctx;
      const rad = this.cw * .42;
      const red = isRedCh(ch);
      const g = ctx.createRadialGradient(x - rad * .3, y - rad * .3, rad * .2, x, y, rad);
      g.addColorStop(0, '#334155'); g.addColorStop(1, '#0b1220');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = red ? 'rgba(248,113,113,.7)' : 'rgba(203,213,225,.6)';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x, y, rad * .86, 0, Math.PI * 2); ctx.stroke();

      const display = this.displayChar(ch);
      ctx.fillStyle = red ? '#f87171' : '#e2e8f0';
      ctx.font = `bold ${this.cw * .52}px "KaiTi","STKaiti",serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(display, x, y + 1);
    }

    displayChar(ch) {
      const map = {
        K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵',
        k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒'
      };
      return map[ch] || ch;
    }

    updateStatus() {
      const el = this.mount.querySelector('#xq-status');
      const checkEl = this.mount.querySelector('#xq-check');
      checkEl.textContent = '';
      if (this.over) {
        el.textContent = this.winner === 'red' ? '红方胜利' : '黑方胜利';
        return;
      }
      if (this.inCheck(this.redTurn)) checkEl.textContent = '将 军！';
      let suffix;
      if (this.isNet) {
        const myTurn = this.redTurn === this.myRed;
        suffix = myTurn ? '轮到你走棋' : '等待对方走棋…';
      } else {
        suffix = this.redTurn === this.aiRed ? 'AI 思考中…' : '轮到你走棋';
      }
      el.textContent = (this.redTurn ? '红方' : '黑方') + '行棋 · ' + suffix;
    }

    /* ---------------- 交互走棋 ---------------- */
    eventPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const vc = Math.round((x - this.pad) / this.cw);
      const vr = Math.round((y - this.pad) / this.cw);
      if (vr < 0 || vr >= ROWS || vc < 0 || vc >= COLS) return null;
      return this.boardOf(vr, vc);
    }

    canAct() {
      if (this.dead || this.over) return false;
      if (this.isNet) return this.redTurn === this.myRed;
      return this.redTurn !== this.aiRed;
    }

    onClick(e) {
      if (!this.canAct()) return;
      const pt = this.eventPoint(e);
      if (!pt) return;
      const [r, c] = pt;
      const ch = this.board[IDX(r, c)];

      if (this.selected) {
        const mv = this.targets.find(m => m[1][0] === r && m[1][1] === c);
        if (mv) { this.doMove(mv, true); return; }
      }
      if (ch !== '.' && isRedCh(ch) === this.redTurn) {
        this.selected = [r, c];
        const all = this.genLegal(this.redTurn);
        this.targets = all.filter(m => m[0][0] === r && m[0][1] === c);
        this.draw();
      } else {
        this.selected = null; this.targets = []; this.draw();
      }
    }

    doMove(mv, humanSide) {
      const [fr, to] = mv;
      if (this.isNet && humanSide) this.opts.room.send({ t: 'mv', fr: fr, to: to });
      this.board[IDX(to[0], to[1])] = this.board[IDX(fr[0], fr[1])];
      this.board[IDX(fr[0], fr[1])] = '.';
      this.lastMove = [fr, to];
      this.selected = null; this.targets = [];
      this.redTurn = !this.redTurn;
      this.draw();

      // 下一手无棋可走：被将死 / 困毙
      if (this.genLegal(this.redTurn).length === 0) {
        this.over = true;
        this.winner = this.redTurn ? 'black' : 'red';
        this.draw(); this.showResult();
        return;
      }
      if (!this.isNet && this.redTurn === this.aiRed) this.aiThink();
    }

    showResult() {
      const ov = this.mount.querySelector('#xq-overlay');
      const txt = this.mount.querySelector('#xq-result');
      const redWin = this.winner === 'red';
      txt.textContent = redWin ? '红方胜利' : '黑方胜利';
      txt.className = 'text-xl sm:text-2xl font-bold mb-4 ' + (this.isNet
        ? ((redWin && this.myRed) || (!redWin && !this.myRed) ? 'text-green-400' : 'text-rose-400')
        : 'text-cyan-300');
      ov.classList.remove('hidden'); ov.classList.add('flex');
    }

    reset() {
      this.board = INIT.split('');
      this.redTurn = true;
      this.over = false;
      this.winner = '';
      this.selected = null;
      this.targets = [];
      this.lastMove = null;
      const ov = this.mount.querySelector('#xq-overlay');
      ov.classList.add('hidden'); ov.classList.remove('flex');
      this.draw();
      if (!this.isNet && this.aiRed === this.redTurn) this.aiThink();
    }

    /* ---------------- 联机 ---------------- */
    bindNet() {
      if (!this.isNet) return;
      this.unsubs.push(this.opts.room.on('data', msg => this.onRemote(msg)));
    }
    onRemote(msg) {
      if (!msg) return;
      if (msg.t === 'mv') {
        const [fr, to] = [msg.fr, msg.to];
        const mv = this.genLegal(this.redTurn).find(m =>
          m[0][0] === fr[0] && m[0][1] === fr[1] && m[1][0] === to[0] && m[1][1] === to[1]);
        if (mv) this.doMove(mv, false);
      } else if (msg.t === 'again') {
        this.reset();
      }
    }

    /* ---------------- AI ---------------- */
    evaluate() {
      let red = 0, black = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.board[IDX(r, c)];
          if (!ch || ch === '.') continue;
          const t = ch.toUpperCase();
          let v = VALUES[t];
          if (t === 'P') {
            if (isRedCh(ch)) { if (r <= 4) v += 10 + (4 - r) * 2; }
            else { if (r >= 5) v += 10 + (r - 5) * 2; }
          }
          if (t === 'N' || t === 'C') v += Math.max(0, 2 - Math.abs(c - 4));
          if (isRedCh(ch)) red += v; else black += v;
        }
      }
      return red - black;
    }

    orderedMoves(red) {
      const moves = this.genLegal(red);
      moves.sort((a, b) => (b[2] ? VALUES[b[2].toUpperCase()] : 0) - (a[2] ? VALUES[a[2].toUpperCase()] : 0));
      return moves;
    }

    make(fr, to) {
      this._cap = this.board[IDX(to[0], to[1])];
      this.board[IDX(to[0], to[1])] = this.board[IDX(fr[0], fr[1])];
      this.board[IDX(fr[0], fr[1])] = '.';
    }
    undo(fr, to) {
      this.board[IDX(fr[0], fr[1])] = this.board[IDX(to[0], to[1])];
      this.board[IDX(to[0], to[1])] = this._cap;
    }

    aiThink() {
      setTimeout(() => {
        if (this.dead || this.over || this.redTurn !== this.aiRed) return;
        let mv;
        if (this.diff === 1) mv = this.aiEasy();
        else if (this.diff === 2) mv = this.aiMedium();
        else mv = this.aiHard();
        if (mv) this.doMove(mv, false);
      }, 300);
    }

    aiEasy() {
      const moves = this.genLegal(this.aiRed);
      // 偶尔挑个吃子，大多数时候随意走
      const caps = moves.filter(m => m[2]);
      if (caps.length && Math.random() < .3) return caps[Math.floor(Math.random() * caps.length)];
      return moves[Math.floor(Math.random() * moves.length)];
    }

    aiMedium() {
      const red = this.aiRed;
      const moves = this.orderedMoves(red);
      let best = null;
      for (const mv of moves) {
        this.make(mv[0], mv[1]);
        const e = this.evaluate();
        this.undo(mv[0], mv[1]);
        const score = red ? e : -e;
        if (!best || score > best.score) best = { mv, score };
      }
      return best.mv;
    }

    aiHard() {
      const red = this.aiRed;
      const depth = window.innerWidth < 640 ? 3 : 4;
      const moves = this.orderedMoves(red);
      let best = null;
      let alpha = -Infinity, beta = Infinity;
      let ply = 0;
      for (const mv of moves) {
        this.make(mv[0], mv[1]);
        const s = -this.search(depth - 1, -beta, -alpha, !red, 1);
        this.undo(mv[0], mv[1]);
        if (s > alpha) { alpha = s; best = mv; }
      }
      return best || this.aiMedium();
    }

    /* 负极大值 Alpha-Beta */
    search(depth, alpha, beta, red, ply) {
      const moves = this.orderedMoves(red);
      if (moves.length === 0) return -(100000 - ply);
      if (depth <= 0) {
        const e = this.evaluate();
        return red ? e : -e;
      }
      let best = -Infinity;
      for (const mv of moves) {
        this.make(mv[0], mv[1]);
        const s = -this.search(depth - 1, -beta, -alpha, !red, ply + 1);
        this.undo(mv[0], mv[1]);
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
  window.GG.xiangqi = {
    start(mount, opts) { this._inst = new Xiangqi(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
