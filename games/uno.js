/* ==================================================================
 * UNO 卡牌模块（两人局）
 *  108 张标准牌：数字 / 禁手 / 反转 / +2 / 万能 / +4
 *  AI：简单 / 中等 / 困难
 *  联机：房主发牌裁判（主机权威），信令：
 *    客→主 {t:'p',i,color} {t:'d'} {t:'n'} {t:'u'} {t:'again'}
 *    主→客 {t:'s', view}
 * ================================================================== */
(function () {
  'use strict';

  // 值定义
  const SKIP = 10, REV = 11, D2 = 12, WILD = 13, W4 = 14;
  const COLOR_HEX = ['#ef4444', '#eab308', '#22c55e', '#2563eb'];
  const COLOR_NAME = ['红', '黄', '绿', '蓝'];

  function makeDeck() {
    const d = [];
    for (let c = 0; c < 4; c++) {
      d.push({ c: c, v: 0 });
      for (let n = 1; n <= 9; n++) { d.push({ c: c, v: n }); d.push({ c: c, v: n }); }
      for (let k = 0; k < 2; k++) {
        d.push({ c: c, v: SKIP }); d.push({ c: c, v: REV }); d.push({ c: c, v: D2 });
      }
    }
    for (let k = 0; k < 4; k++) { d.push({ c: -1, v: WILD }); d.push({ c: -1, v: W4 }); }
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function cardSym(card) {
    if (card.v <= 9) return String(card.v);
    return { 10: '⊘', 11: '⇄', 12: '+2', 13: 'W', 14: '+4' }[card.v];
  }

  class Uno {
    constructor(mount, opts) {
      this.mount = mount;
      this.opts = opts;
      this.isNet = opts.mode === 'net';
      this.amHost = !this.isNet || opts.seat === 0;
      this.diff = opts.diff || 2;

      this.unsubs = [];
      this.dead = false;

      if (this.amHost) {
        this.initState();
        this.build();
        this.bindNet();
        this.startRound(true);
      } else {
        this.view = null;
        this.build();
        this.bindNet();
        this.renderGuestShell();
      }
    }

    /* ---------------- 状态初始化（仅房主 / 本地） ---------------- */
    initState() {
      this.deck = shuffle(makeDeck());
      this.discard = [];
      this.hands = [[], []];
      this.turn = 1;
      this.dir = 1;
      this.color = -1;
      this.over = false;
      this.winner = -1;
      this.phase = 'play';       // play / choice / pickstart
      this.drawnI = -1;
      this.unoReady = [false, false];
      this.unoCalled = [false, false];
      this.unoTimer = [null, null];
      this.msg = '';
    }

    draw(who) {
      if (this.deck.length === 0) this.rebuildDeck();
      const card = this.deck.pop();
      this.hands[who].push(card);
      return card;
    }
    rebuildDeck() {
      if (this.discard.length <= 1) return;
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    penalty(who, n) {
      for (let i = 0; i < n; i++) this.draw(who);
    }

    playable(card) {
      const top = this.discard[this.discard.length - 1];
      if (card.c === -1) {
        if (card.v === W4) {
          // 规则：仅当手中没有与当前颜色相同的牌时允许 +4
          return !this.hands[this.turn].some(x => x.c === this.color);
        }
        return true;
      }
      return card.c === this.color || card.v === top.v;
    }

    /* ---------------- 开局发牌 ---------------- */
    startRound(initial) {
      if (!initial) this.initState();
      for (let i = 0; i < 7; i++) { this.draw(0); this.draw(1); }
      // 翻首张（+4 重洗）
      let first;
      do {
        if (this.deck.length === 0) this.rebuildDeck();
        first = this.deck.pop();
        if (first.v === W4) { this.deck.unshift(first); shuffle(this.deck); }
      } while (first.v === W4);
      this.discard.push(first);
      this.color = first.c;

      // 起始牌效果：默认先手为 1 号（非发牌方）
      this.turn = 1;
      if (first.c === -1) {
        this.phase = 'pickstart';
        this.msg = '首张是万能牌，请先手指定颜色';
      } else if (first.v === SKIP || first.v === REV) {
        this.turn = 0;
        this.msg = '首张功能牌，先手被跳过，房主先出';
      } else if (first.v === D2) {
        this.penalty(1, 2);
        this.turn = 0;
        this.msg = '先手被罚摸 2 张并跳过';
      } else {
        this.msg = '对局开始';
      }

      this.afterTurnChange();
    }

    advance(n) {
      n = n || 1;
      this.turn = (this.turn + this.dir * n) % 2;
      if (this.turn < 0) this.turn += 2;
    }

    /* 每次行动后：继续 AI / 等待 / 结束 */
    afterTurnChange() {
      this.pushView();
      if (this.over) return;
      if (!this.isNet && this.turn === 1) setTimeout(() => this.aiAct(), 650);
      if (this.isNet && this.turn === 0 && this.amHost && this.phase === 'play') { /* 房主自己 */ }
    }

    /* ---------------- 出牌提交 ---------------- */
    commitPlay(who, i, chosenColor) {
      if (this.over || who !== this.turn) return false;
      const hand = this.hands[who];
      if (i < 0 || i >= hand.length) return false;
      const card = hand[i];
      if (!this.playable(card)) return false;

      hand.splice(i, 1);
      this.discard.push(card);
      this.phase = 'play';
      this.drawnI = -1;

      if (card.c === -1) this.color = chosenColor;
      else this.color = card.c;

      // UNO 判定
      if (hand.length === 1) {
        if (this.unoReady[who]) this.unoCalled[who] = true;
        if (!this.unoCalled[who]) this.openUnoWindow(who);
      }
      if (hand.length === 0) {
        this.over = true;
        this.winner = who;
        this.msg = (who === 0 ? '房主' : '对手') + '出完了所有手牌';
        this.pushView();
        return true;
      }

      // 功能牌效果
      if (card.v === SKIP) {
        this.msg = '禁手：对手跳过回合';
        this.advance(2);
      } else if (card.v === REV) {
        this.dir *= -1;
        this.msg = '反转：你继续出牌';
        // 两人局中反转等于对手被跳过
        this.advance(2);
      } else if (card.v === D2) {
        const next = (who + 1) % 2;
        this.penalty(next, 2);
        this.msg = '对手罚摸 2 张并跳过';
        this.advance(2);
      } else if (card.v === W4) {
        const next = (who + 1) % 2;
        this.penalty(next, 4);
        this.msg = '对手罚摸 4 张并跳过';
        this.advance(2);
      } else {
        this.msg = '';
        this.advance(1);
      }
      this.afterTurnChange();
      return true;
    }

    /* 摸牌（玩家主动） */
    humanDraw(who) {
      if (this.over || who !== this.turn || this.phase !== 'play') return;
      const card = this.draw(who);
      this.msg = '摸到一张牌';
      if (this.playable(card)) {
        this.phase = 'choice';
        this.drawnI = this.hands[who].length - 1;
      } else {
        this.msg = '无牌可出，跳过回合';
        this.phase = 'play';
        this.advance(1);
        this.afterTurnChange();
        return;
      }
      this.pushView();
    }

    humanPass(who) {
      if (this.over || who !== this.turn || this.phase !== 'choice') return;
      this.phase = 'play';
      this.drawnI = -1;
      this.msg = '选择不出，跳过回合';
      this.advance(1);
      this.afterTurnChange();
    }

    /* ---------------- UNO 喊牌窗口 ---------------- */
    openUnoWindow(who) {
      this.msg = (who === 0 ? '你' : '对手') + '只剩一张牌，请尽快喊 UNO';
      this.unoTimer[who] = setTimeout(() => {
        if (this.dead || this.over) return;
        if (!this.unoCalled[who] && this.hands[who].length === 1) {
          this.penalty(who, 2);
          this.msg = '未及时喊 UNO，罚摸 2 张';
          this.pushView();
        }
      }, 3000);
    }
    callUno(who) {
      const hand = this.hands[who];
      if (hand.length === 1 || hand.length === 2) {
        this.unoCalled[who] = true;
        if (hand.length === 2) this.unoReady[who] = true;
        this.msg = (who === 0 ? '你' : '对手') + '喊了 UNO！';
        this.pushView();
      }
    }

    /* ---------------- AI ---------------- */
    aiAct() {
      if (this.dead || this.over || this.turn !== 1) return;
      const hand = this.hands[1];

      // 起始万能牌：AI 指定颜色，之后仍由 AI 出牌
      if (this.phase === 'pickstart') {
        this.color = this.aiPickColor();
        this.phase = 'play';
        this.msg = 'AI 指定了' + COLOR_NAME[this.color];
        this.afterTurnChange();
        return;
      }

      const playableIdx = [];
      hand.forEach((card, i) => { if (this.playable(card)) playableIdx.push(i); });

      if (playableIdx.length === 0) {
        const card = this.draw(1);
        if (this.playable(card) && (this.diff > 1 || Math.random() < .5)) {
          this.aiCommit(hand.length - 1);
        } else {
          this.msg = 'AI 无牌可出，跳过';
          this.advance(1);
          this.afterTurnChange();
        }
        return;
      }

      const i = this.diff === 1 ? this.aiEasy(playableIdx) : this.aiPick(playableIdx);
      this.aiCommit(i);
    }

    aiCommit(i) {
      const card = this.hands[1][i];
      let color = 0;
      if (card.c === -1) {
        color = this.diff === 1 ? Math.floor(Math.random() * 4) : this.aiPickColor();
      }
      // AI 自动喊 UNO
      if (this.hands[1].length <= 2) {
        this.unoReady[1] = true;
        this.unoCalled[1] = true;
      }
      this.commitPlay(1, i, color);
    }

    aiEasy(idx) {
      return idx[Math.floor(Math.random() * idx.length)];
    }

    aiScore(card) {
      const opp = this.hands[0].length;
      const own = this.hands[1].length;
      let s;
      if (card.v <= 9) s = card.v;
      else if (card.v === SKIP || card.v === REV) {
        s = 22 + (this.diff === 3 && opp <= 3 ? 45 : 0);
      } else if (card.v === D2) {
        s = 30 + (this.diff === 3 && opp <= 4 ? 60 : 0);
      } else if (card.v === WILD) {
        s = this.diff === 3 ? (own <= 4 ? 40 : 14) : 16;
      } else {
        s = this.diff === 3 ? (opp <= 2 ? 120 : 8) : 10;
      }
      if (this.diff === 3 && own <= 4 && card.c !== -1) s *= 1.5;
      return s;
    }

    aiPick(idx) {
      let best = -1, bestS = -Infinity;
      for (const i of idx) {
        const s = this.aiScore(this.hands[1][i]);
        if (s > bestS) { bestS = s; best = i; }
      }
      return best;
    }

    aiPickColor() {
      const cnt = [0, 0, 0, 0];
      this.hands[1].forEach(card => { if (card.c >= 0) cnt[card.c]++; });
      let best = 0;
      for (let c = 1; c < 4; c++) if (cnt[c] > cnt[best]) best = c;
      if (this.diff === 3) {
        // 困难：把功能牌也计入颜色选择
        this.hands[1].forEach(card => {
          if (card.c >= 0 && card.v >= SKIP) cnt[card.c] += 1;
        });
        for (let c = 0; c < 4; c++) if (cnt[c] > cnt[best]) best = c;
      }
      return best;
    }

    /* ---------------- 联机视图同步 ---------------- */
    guestView() {
      return {
        hand: this.hands[1].map(c => c),
        opp: this.hands[0].length,
        top: this.discard[this.discard.length - 1],
        color: this.color,
        turn: this.turn,
        dir: this.dir,
        deckN: this.deck.length,
        phase: this.phase,
        drawnI: this.drawnI,
        msg: this.msg,
        over: this.over,
        winner: this.winner,
        unoReady: this.unoReady[1],
        unoCalled: this.unoCalled[1]
      };
    }
    pushView() {
      this.render();
      if (this.isNet && this.opts.room && this.amHost) {
        this.opts.room.send({ t: 's', view: this.guestView() });
      }
    }

    bindNet() {
      if (!this.isNet) return;
      this.unsubs.push(this.opts.room.on('data', msg => this.onRemote(msg)));
      if (!this.amHost) {
        this.unsubs.push(this.opts.room.on('close', () => {
          if (!this.dead) this.opts.toast('房主已离开对局');
        }));
      }
    }

    onRemote(msg) {
      if (!msg) return;
      if (this.amHost) {
        // 房主接收客人意图：UNO 呼叫 / 再次开局不受回合限制
        if (msg.t === 'u') { this.callUno(1); return; }
        if (msg.t === 'again') { this.startRound(false); return; }
        if (msg.t === 'c') {
          // 客人为先手时指定起始颜色，指定后仍由客人出牌
          if (this.phase === 'pickstart' && this.turn === 1) {
            this.color = msg.color;
            this.phase = 'play';
            this.msg = '对手指定了' + COLOR_NAME[msg.color];
            this.pushView();
          }
          return;
        }
        if (this.turn !== 1) return;
        if (msg.t === 'p') {
          this.commitPlay(1, msg.i, msg.color);
        } else if (msg.t === 'd') {
          this.humanDraw(1);
        } else if (msg.t === 'n') {
          this.humanPass(1);
        }
      } else {
        // 客人接收状态
        if (msg.t === 's') { this.view = msg.view; this.renderGuest(); }
        else if (msg.t === 'again') { this.opts.toast('房主开启了新对局'); }
      }
    }

    /* ---------------- UI 构建 ---------------- */
    build() {
      const wrap = document.createElement('div');
      wrap.className = 'glass-card panel-card p-3 sm:p-5';
      wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p id="uno-msg" class="text-xs text-slate-300"></p>
          <p class="text-[11px] text-slate-500">牌堆 <span id="uno-deckn">–</span> 张</p>
        </div>
        <div id="uno-table"></div>
        <div class="flex items-center justify-center gap-2 mt-4 flex-wrap">
          <button id="uno-restart" class="btn-ghost"><i class="fa-solid fa-rotate-right"></i>重新开局</button>
        </div>
        <div id="uno-colorpick" class="hidden fixed inset-0 z-[70] items-center justify-center"
             style="background:rgba(2,6,23,.7);backdrop-filter:blur(3px)">
          <div class="text-center">
            <p class="text-sm text-slate-200 mb-4">请选择指定的颜色</p>
            <div class="grid grid-cols-2 gap-3 w-52">
              ${[0,1,2,3].map(c => `
                <button data-c="${c}" class="h-16 rounded-xl text-white font-bold"
                        style="background:${COLOR_HEX[c]}">${COLOR_NAME[c]}</button>`).join('')}
            </div>
          </div>
        </div>
        <div id="uno-resultmask" class="hidden fixed inset-0 z-[75] items-center justify-center px-6"
             style="background:rgba(2,6,23,.72);backdrop-filter:blur(3px)">
          <div class="text-center glass-card panel-card p-7">
            <p id="uno-resulttxt" class="text-2xl font-bold mb-4"></p>
            <button id="uno-resultagain" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
          </div>
        </div>`;
      this.mount.appendChild(wrap);

      wrap.querySelector('#uno-restart').addEventListener('click', () => this.requestRestart());
      wrap.querySelector('#uno-resultagain').addEventListener('click', () => this.requestRestart());
      wrap.querySelectorAll('[data-c]').forEach(b => {
        b.addEventListener('click', () => this.onColorPicked(Number(b.dataset.c)));
      });
    }

    requestRestart() {
      if (this.isNet) {
        if (!this.amHost) {
          this.opts.room.send({ t: 'again' });
          this.opts.toast('已向房主请求新对局');
          return;
        }
        this.startRound(false);
      } else {
        this.startRound(false);
      }
    }

    /* 颜色选择弹窗 */
    askColor(cb) {
      this._colorCb = cb;
      const mask = this.mount.querySelector('#uno-colorpick');
      mask.classList.remove('hidden'); mask.classList.add('flex');
    }
    onColorPicked(c) {
      const mask = this.mount.querySelector('#uno-colorpick');
      mask.classList.add('hidden'); mask.classList.remove('flex');
      if (this._colorCb) { const cb = this._colorCb; this._colorCb = null; cb(c); }
    }

    cardHTML(card, opts) {
      opts = opts || {};
      if (opts.back) {
        return `<div class="uno-card rounded-lg flex items-center justify-center font-bold select-none"
                  style="background:linear-gradient(135deg,#0e7490,#1e1b4b);border:1px solid rgba(103,232,249,.4)">
                  <span class="text-cyan-200 text-lg"><i class="fa-solid fa-star"></i></span>
                </div>`;
      }
      const wild = card.c === -1;
      const bg = wild
        ? 'linear-gradient(135deg,#1e293b,#0f172a)'
        : COLOR_HEX[card.c];
      const darkTxt = !wild && card.c === 1;
      const sym = cardSym(card);
      const wildRing = wild
        ? `<span class="absolute inset-1 rounded-md" style="background:conic-gradient(#ef4444 0 25%,#eab308 0 50%,#22c55e 0 75%,#2563eb 0);opacity:.85"></span>
           <span class="absolute inset-[14px] rounded-full bg-slate-900"></span>` : '';
      return `
        <div class="uno-card relative rounded-lg flex items-center justify-center font-extrabold select-none"
             style="background:${bg};border:1px solid rgba(255,255,255,.25);color:${darkTxt ? '#1e293b' : '#fff'}">
          ${wildRing}
          <span class="absolute top-0.5 left-1 text-[9px] leading-none z-10">${sym}</span>
          <span class="relative z-10 text-xl ${wild ? 'text-white' : ''}">${sym}</span>
        </div>`;
    }

    /* 房主 / 本地渲染 */
    render() {
      const table = this.mount.querySelector('#uno-table');
      if (!table) return;
      const myTurn = this.turn === 0;
      const oppN = this.hands[1].length;
      const top = this.discard[this.discard.length - 1];
      const canDraw = myTurn && this.phase === 'play';
      const canPickStart = this.phase === 'pickstart' && (!this.isNet);

      table.innerHTML = `
        <style>
          .uno-card { width:3rem; height:4.5rem; }
          @media (min-width:640px){ .uno-card { width:3.5rem; height:5.2rem; } }
          .hand-card { transition:transform .15s ease; cursor:pointer; }
          .hand-card:hover { transform:translateY(-8px); }
          .hand-card.disabled { opacity:.45; cursor:default; }
          .hand-card.disabled:hover { transform:none; }
        </style>
        <!-- 对手 -->
        <div class="flex items-center justify-center gap-2 mb-3">
          <span class="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm">
            <i class="fa-solid fa-user-group text-slate-300"></i>
          </span>
          <div class="flex">
            ${Array.from({ length: Math.min(oppN, 7) }).map(() =>
              `<div class="-ml-3 first:ml-0 scale-[.78]">${this.cardHTML(null, { back: true })}</div>`).join('')}
          </div>
          <span class="text-xs text-slate-400 ml-1">${oppN} 张</span>
        </div>

        <!-- 中央牌区 -->
        <div class="flex items-center justify-center gap-5 sm:gap-8 py-3">
          <div class="text-center">
            <button id="pile-draw" ${canDraw || canPickStart ? '' : 'disabled'}
                    class="hand-card ${canDraw || canPickStart ? '' : 'disabled'}">
              ${this.cardHTML(null, { back: true })}
            </button>
            <p class="text-[10.5px] text-slate-500 mt-1.5">摸牌</p>
          </div>
          <div class="text-center">
            <div>${top ? this.cardHTML(top) : ''}</div>
            <p class="text-[10.5px] mt-1.5" style="color:${this.color >= 0 ? COLOR_HEX[this.color] : '#94a3b8'}">
              <i class="fa-solid fa-droplet"></i> ${this.color >= 0 ? COLOR_NAME[this.color] + '色' : '未定'}
            </p>
          </div>
        </div>

        <p class="text-center text-[11px] text-slate-400 mb-2">
          <i class="fa-solid fa-${this.dir === 1 ? 'arrow-down' : 'arrow-up'} mr-1"></i>${myTurn ? '你的回合' : '对手回合'}
          ${this.phase === 'choice' ? ' · 摸到的牌可打出或不要' : ''}
        </p>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-center gap-2 mb-2 flex-wrap">
          ${this.phase === 'choice' ? `
            <button id="btn-pass" class="btn-ghost"><i class="fa-solid fa-ban"></i>不要</button>` : ''}
          <button id="btn-uno"
                  class="btn-primary ${this.hands[0].length <= 2 ? '' : 'opacity-40'}"
                  ${this.hands[0].length <= 2 ? '' : 'disabled'}>
            <i class="fa-solid fa-bullhorn"></i>UNO!</button>
        </div>

        <!-- 我的手牌 -->
        <div class="flex items-center justify-center flex-wrap gap-1.5 pt-2">
          ${this.hands[0].map((card, i) => {
            const canPlay = myTurn && (this.phase === 'play' || this.phase === 'choice')
                            && this.playable(card);
            return `<button class="hand-card ${canPlay ? '' : 'disabled'}" data-i="${i}">
                      ${this.cardHTML(card)}</button>`;
          }).join('')}
        </div>`;

      this.mount.querySelector('#uno-msg').textContent = this.msg || '';
      this.mount.querySelector('#uno-deckn').textContent = this.deck.length;

      // 绑定
      const drawBtn = table.querySelector('#pile-draw');
      drawBtn.addEventListener('click', () => {
        if (this.phase === 'pickstart') {
          this.askColor(c => {
            this.color = c; this.phase = 'play';
            this.msg = '指定了' + COLOR_NAME[c];
            // 先手仍是 AI，交给 AI 出牌
            this.afterTurnChange();
          });
          return;
        }
        this.humanDraw(0);
      });
      const passBtn = table.querySelector('#btn-pass');
      if (passBtn) passBtn.addEventListener('click', () => this.humanPass(0));
      table.querySelector('#btn-uno').addEventListener('click', () => this.callUno(0));
      table.querySelectorAll('[data-i]').forEach(b => {
        b.addEventListener('click', () => {
          if (!myTurn) return;
          const i = Number(b.dataset.i);
          const card = this.hands[0][i];
          if (!this.playable(card)) return;
          if (card.c === -1) {
            this.askColor(c => this.commitPlay(0, i, c));
          } else {
            this.commitPlay(0, i, 0);
          }
        });
      });

      if (this.over) this.showResult(this.winner === 0);
    }

    /* ---------------- 客人薄客户端 ---------------- */
    renderGuestShell() {
      const table = this.mount.querySelector('#uno-table');
      if (table) table.innerHTML = '<p class="text-center text-xs text-slate-500 py-10">等待房主发牌…</p>';
    }
    renderGuest() {
      const v = this.view;
      const table = this.mount.querySelector('#uno-table');
      const myTurn = v.turn === 1;

      table.innerHTML = `
        <style>
          .uno-card { width:3rem; height:4.5rem; }
          @media (min-width:640px){ .uno-card { width:3.5rem; height:5.2rem; } }
          .hand-card { transition:transform .15s ease; cursor:pointer; }
          .hand-card:hover { transform:translateY(-8px); }
          .hand-card.disabled { opacity:.45; cursor:default; }
          .hand-card.disabled:hover { transform:none; }
        </style>
        <div class="flex items-center justify-center gap-2 mb-3">
          <span class="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm">
            <i class="fa-solid fa-user-group text-slate-300"></i>
          </span>
          <div class="flex">
            ${Array.from({ length: Math.min(v.opp, 7) }).map(() =>
              `<div class="-ml-3 first:ml-0 scale-[.78]">${this.cardHTML(null, { back: true })}</div>`).join('')}
          </div>
          <span class="text-xs text-slate-400 ml-1">${v.opp} 张</span>
        </div>

        <div class="flex items-center justify-center gap-5 sm:gap-8 py-3">
          <div class="text-center">
            <button id="pile-draw" class="hand-card ${myTurn && v.phase === 'play' ? '' : 'disabled'}"
                    ${myTurn && v.phase === 'play' ? '' : 'disabled'}>
              ${this.cardHTML(null, { back: true })}
            </button>
            <p class="text-[10.5px] text-slate-500 mt-1.5">摸牌</p>
          </div>
          <div class="text-center">
            <div>${this.cardHTML(v.top)}</div>
            <p class="text-[10.5px] mt-1.5" style="color:${v.color >= 0 ? COLOR_HEX[v.color] : '#94a3b8'}">
              <i class="fa-solid fa-droplet"></i> ${v.color >= 0 ? COLOR_NAME[v.color] + '色' : '未定'}
            </p>
          </div>
        </div>

        <p class="text-center text-[11px] text-slate-400 mb-2">
          <i class="fa-solid fa-${v.dir === 1 ? 'arrow-down' : 'arrow-up'} mr-1"></i>${myTurn ? '你的回合' : '对手回合'}
          ${v.phase === 'choice' ? ' · 摸到的牌可打出或不要' : ''}
          ${v.phase === 'pickstart' ? ' · 请先指定颜色' : ''}
        </p>

        <div class="flex items-center justify-center gap-2 mb-2 flex-wrap">
          ${v.phase === 'choice' ? '<button id="btn-pass" class="btn-ghost"><i class="fa-solid fa-ban"></i>不要</button>' : ''}
          <button id="btn-uno" class="btn-primary ${v.hand.length <= 2 ? '' : 'opacity-40'}"
                  ${v.hand.length <= 2 ? '' : 'disabled'}>
            <i class="fa-solid fa-bullhorn"></i>UNO!</button>
        </div>

        <div class="flex items-center justify-center flex-wrap gap-1.5 pt-2">
          ${v.hand.map((card, i) => {
            const canPlay = myTurn && (v.phase === 'play' || v.phase === 'choice');
            return `<button class="hand-card ${canPlay ? '' : 'disabled'}" data-i="${i}">
                      ${this.cardHTML(card)}</button>`;
          }).join('')}
        </div>`;

      this.mount.querySelector('#uno-msg').textContent = v.msg || '';
      this.mount.querySelector('#uno-deckn').textContent = v.deckN;

      const room = this.opts.room;
      table.querySelector('#pile-draw').addEventListener('click', () => {
        if (v.phase === 'pickstart') {
          this.askColor(c => room.send({ t: 'c', color: c }));
          return;
        }
        room.send({ t: 'd' });
      });
      const passBtn = table.querySelector('#btn-pass');
      if (passBtn) passBtn.addEventListener('click', () => room.send({ t: 'n' }));
      table.querySelector('#btn-uno').addEventListener('click', () => room.send({ t: 'u' }));
      table.querySelectorAll('[data-i]').forEach(b => {
        b.addEventListener('click', () => {
          if (!myTurn) return;
          const i = Number(b.dataset.i);
          const card = v.hand[i];
          if (card.c === -1) {
            this.askColor(c => room.send({ t: 'p', i: i, color: c }));
          } else {
            room.send({ t: 'p', i: i, color: 0 });
          }
        });
      });

      if (v.over) this.showResult(v.winner === 1);
    }

    showResult(iWon) {
      const mask = this.mount.querySelector('#uno-resultmask');
      const txt = this.mount.querySelector('#uno-resulttxt');
      txt.textContent = iWon ? '你赢了！' : '你输了';
      txt.className = 'text-2xl font-bold mb-4 ' + (iWon ? 'text-green-400' : 'text-rose-400');
      mask.classList.remove('hidden'); mask.classList.add('flex');
    }

    stop() {
      this.dead = true;
      if (this.unoTimer) this.unoTimer.forEach(t => clearTimeout(t));
      this.unsubs.forEach(un => { try { un(); } catch (e) {} });
      this.mount.innerHTML = '';
    }
  }

  window.GG = window.GG || {};
  window.GG.uno = {
    start(mount, opts) { this._inst = new Uno(mount, opts); return this._inst; },
    stop() { if (this._inst) { this._inst.stop(); this._inst = null; } }
  };
})();
