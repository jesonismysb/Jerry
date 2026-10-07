/* ==================================================================
 * UNO 卡牌模块（2-6 人）
 *  108 张标准牌：数字 / 跳过 / 反转 / +2 / 变色 / +4 变色
 *  模式：AI 单机（空位由 AI 填充，难度 简单/普通）｜ WebRTC 联机（房主权威，最多 6 人）
 *  规则：打出倒数第二张牌前需喊「UNO!」，忘记喊可被下家举报罚摸 2 张
 *  联机信令：
 *    客→主 {t:'p',i,color} {t:'d'} {t:'n'} {t:'u'} {t:'catch'} {t:'again'}
 *    主→客 {t:'s', view}（view 仅含该玩家自己的手牌，保证信息隐藏）
 * ================================================================== */
(function () {
  'use strict';

  const SKIP = 10, REV = 11, D2 = 12, WILD = 13, W4 = 14;
  const COLOR_HEX = ['#ef4444', '#eab308', '#22c55e', '#2563eb'];
  const COLOR_NAME = ['红', '黄', '绿', '蓝'];

  /* ---------------- 音效（WebAudio 合成，零外部资源） ---------------- */
  const Snd = {
    ctx: null, on: true,
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return this.ctx;
    },
    tone(f, dur, type, vol, delay) {
      const ctx = this.ctx;
      const t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    play(kind) {
      if (!this.on || !this.ensure()) return;
      switch (kind) {
        case 'play':   this.tone(540, .07, 'triangle', .16, 0); this.tone(830, .08, 'triangle', .13, .05); break;
        case 'action': this.tone(720, .08, 'sawtooth', .09, 0); this.tone(400, .13, 'sawtooth', .09, .07); break;
        case 'draw':   this.tone(270, .09, 'sine', .15, 0); break;
        case 'uno':    this.tone(880, .09, 'sine', .2, 0); this.tone(1174, .13, 'sine', .2, .1); break;
        case 'catch':  this.tone(220, .14, 'square', .1, 0); this.tone(175, .2, 'square', .1, .12); break;
        case 'win':    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .15, 'triangle', .18, i * .11)); break;
        case 'lose':   [392, 330, 262, 196].forEach((f, i) => this.tone(f, .17, 'sine', .15, i * .13)); break;
      }
    }
  };
  // 首次交互解锁音频上下文
  document.addEventListener('pointerdown', () => Snd.ensure(), { passive: true });

  /* ---------------- 牌组 ---------------- */
  function makeDeck() {
    const d = [];
    for (let c = 0; c < 4; c++) {
      d.push({ c: c, v: 0 });
      for (let n = 1; n <= 9; n++) { d.push({ c: c, v: n }); d.push({ c: c, v: n }); }
      for (let k = 0; k < 2; k++) { d.push({ c: c, v: SKIP }); d.push({ c: c, v: REV }); d.push({ c: c, v: D2 }); }
    }
    for (let k = 0; k < 4; k++) { d.push({ c: -1, v: WILD }); d.push({ c: -1, v: W4 }); }
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function cardSym(card) {
    if (card.v <= 9) return String(card.v);
    return { 10: '⊘', 11: '⇄', 12: '+2', 13: 'W', 14: '+4' }[card.v];
  }
  function cardBg(card) {
    if (card.c < 0) return 'conic-gradient(#ef4444,#eab308,#22c55e,#2563eb,#ef4444)';
    return COLOR_HEX[card.c];
  }

  /* ---------------- 样式（注入一次） ---------------- */
  const CSS = `
    .uno-card{position:relative;width:3rem;height:4.4rem;border-radius:.55rem;border:2px solid rgba(255,255,255,.85);
      box-shadow:0 3px 10px rgba(2,8,23,.5);color:#fff;font-weight:800;display:inline-flex;align-items:center;justify-content:center;
      flex:none;transition:transform .15s ease,box-shadow .15s ease,opacity .15s ease;cursor:pointer;user-select:none;
      text-shadow:0 1px 3px rgba(0,0,0,.45);padding:0}
    @media(min-width:640px){.uno-card{width:3.4rem;height:5rem}}
    .uno-card .csym{font-size:1.15rem;line-height:1}
    .uno-card .ccorner{position:absolute;top:2px;left:4px;font-size:.55rem;opacity:.92}
    .uno-card.mini{width:1.35rem;height:2rem;border-width:1.5px;border-radius:.32rem;cursor:default;box-shadow:0 1px 4px rgba(2,8,23,.4)}
    .uno-card.big{width:4.2rem;height:6.2rem;cursor:default}
    .uno-card.big .csym{font-size:1.7rem}
    .uno-card.playable:hover{transform:translateY(-9px);box-shadow:0 12px 22px rgba(103,232,249,.28)}
    .uno-card.dim{opacity:.35;filter:saturate(.55);cursor:default}
    .uno-card.back{background:repeating-linear-gradient(45deg,#0f172a,#0f172a 5px,#155e75 5px,#155e75 10px);border-color:rgba(103,232,249,.45)}
    .uno-sel{outline:2px solid #67e8f9;outline-offset:2px}
    @keyframes unoPulse{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.55)}50%{box-shadow:0 0 0 9px rgba(250,204,21,0)}}
    .uno-pulse{animation:unoPulse 1.1s infinite}
    .uno-badge{transition:all .25s ease}
    .uno-badge.turn{border-color:rgba(103,232,249,.65);background:rgba(103,232,249,.1);box-shadow:0 0 14px rgba(103,232,249,.18)}
    .uno-scroll::-webkit-scrollbar{height:5px}
    .uno-scroll::-webkit-scrollbar-thumb{background:rgba(103,232,249,.25);border-radius:3px}
  `;

  /* ==================================================================
   * 主类
   * ================================================================== */
  class Uno {
    constructor(mount, opts) {
      this.mount = mount;
      this.toast = opts.toast || function () {};
      this.mode = opts.mode;
      this.diff = opts.diff || 2;
      this.mySeat = opts.seat || 0;
      this.room = opts.room || null;
      this.isNet = this.mode === 'net';
      this.dead = false;
      this.timers = [];
      this._unsub = [];
      this.pendingPick = -1;      // 等待选色的手牌下标
      this.lastFxSeq = 0;
      this._overFxDone = false;

      if (!document.getElementById('uno-style')) {
        const st = document.createElement('style');
        st.id = 'uno-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      }

      // 玩家人数与座位
      this.n = Math.min(6, Math.max(2, opts.count || 2));
      this.players = [];
      if (this.isNet) {
        this.netRole = this.mySeat === 0 ? 'host' : 'guest';
        for (let i = 0; i < this.n; i++) {
          this.players.push({ kind: i === this.mySeat ? 'human' : (this.netRole === 'host' ? 'net' : 'net'),
            name: i === 0 ? '房主' : '玩家 ' + (i + 1) });
        }
        if (this.netRole === 'host') this.players[0].name = '房主（你）';
      } else {
        this.netRole = 'local';
        this.mySeat = 0;
        const dLabel = this.diff === 1 ? '简单' : '普通';
        this.players.push({ kind: 'human', name: '你' });
        for (let i = 1; i < this.n; i++) this.players.push({ kind: 'ai', name: 'AI·' + dLabel + ' ' + i });
      }

      // 事件委托（mount 常驻）
      this._onClick = e => this.handleClick(e);
      this.mount.addEventListener('click', this._onClick);

      if (this.netRole === 'guest') {
        this.bindGuest();
        this.renderWaiting();
      } else {
        if (this.netRole === 'host') this.bindHost();
        this.newGame();
        this.render();
        this.pump();
      }
    }

    /* ==================== 生命周期 ==================== */
    delay(fn, ms) {
      const t = setTimeout(() => { if (!this.dead) fn(); }, ms);
      this.timers.push(t);
      return t;
    }
    destroy() {
      this.dead = true;
      this.timers.forEach(clearTimeout);
      this._unsub.forEach(un => { try { un(); } catch (e) {} });
      this.mount.removeEventListener('click', this._onClick);
      this.mount.innerHTML = '';
    }

    /* ==================== 开局 ==================== */
    newGame() {
      const deck = shuffle(makeDeck());
      const hands = [];
      for (let i = 0; i < this.n; i++) hands.push(deck.splice(0, 7));
      // 首张牌：+4 重洗
      let first = deck.pop();
      while (first.v === W4) { deck.unshift(first); shuffle(deck); first = deck.pop(); }

      this.st = {
        deck: deck, discard: [first], hands: hands,
        turn: 0, dir: 1, color: first.c,
        over: false, winner: -1,
        phase: 'play', drawnI: -1,
        catchSeat: -1, catchBy: -1,
        declared: new Array(this.n).fill(false),
        fx: { seq: 0, kind: '' },
        msg: ''
      };
      this.pendingPick = -1;
      this._overFxDone = false;

      // 首张功能牌结算
      if (first.v === WILD) {
        this.st.phase = 'pickstart';
        this.st.msg = '首张为变色牌，请 ' + this.nameOf(0) + ' 选择起始颜色';
      } else if (first.v === SKIP) {
        this.st.turn = this.nextSeat(0);
        this.st.msg = '首张为跳过，' + this.nameOf(0) + ' 停牌一轮';
      } else if (first.v === REV) {
        this.st.dir = -1;
        this.st.msg = '首张为反转，逆时针出牌';
      } else if (first.v === D2) {
        this.drawCards(0, 2, true);
        this.st.turn = this.nextSeat(0);
        this.st.msg = '首张为 +2，' + this.nameOf(0) + ' 罚摸 2 张并停牌';
      } else {
        this.st.msg = '对局开始，轮到 ' + this.nameOf(0);
      }
      this.pushViews();
    }

    nameOf(s) {
      if (s === this.mySeat) return '你';
      return this.players[s] ? this.players[s].name : '玩家 ' + (s + 1);
    }
    nextSeat(s) { return ((s + this.st.dir) % this.n + this.n) % this.n; }
    advanceFrom(s, steps) { return ((s + this.st.dir * steps) % this.n + this.n) % this.n; }
    fx(kind) {
      this.st.fx = { seq: this.st.fx.seq + 1, kind: kind };
      if (this.netRole !== 'guest') Snd.play(kind);
    }

    playable(card) {
      if (card.c < 0) return true;
      const top = this.st.discard[this.st.discard.length - 1];
      return card.c === this.st.color || card.v === top.v;
    }
    canW4(hand, i) {
      const st = this.st;
      return !hand.some((c, idx) => idx !== i && c.c === st.color);
    }

    drawCards(who, k, silent) {
      const st = this.st;
      const out = [];
      for (let i = 0; i < k; i++) {
        if (!st.deck.length) {
          // 弃牌堆（除顶）重洗为牌堆
          const top = st.discard.pop();
          if (!st.discard.length) { st.discard.push(top); break; }
          st.deck = shuffle(st.discard);
          st.discard = [top];
        }
        const card = st.deck.pop();
        st.hands[who].push(card);
        out.push(card);
      }
      if (!silent && out.length) this.fx('draw');
      return out;
    }

    /* ==================== 动作 ==================== */
    clearCatchIfActor(who) {
      const st = this.st;
      if (st.catchSeat >= 0 && st.catchBy === who) { st.catchSeat = -1; st.catchBy = -1; }
    }

    commitPlay(who, i, chosenColor) {
      const st = this.st;
      if (st.over || st.turn !== who) return false;
      if (st.phase !== 'play' && st.phase !== 'choice') return false;
      if (st.phase === 'choice' && i !== st.drawnI) return false;
      const hand = st.hands[who];
      const card = hand[i];
      if (!card || !this.playable(card)) return false;
      if (card.v === W4 && !this.canW4(hand, i)) {
        if (who === this.mySeat) this.toast('手中还有当前颜色的牌，不能出 +4');
        return false;
      }
      if (card.c < 0 && (chosenColor == null || chosenColor < 0)) return false;

      this.clearCatchIfActor(who);
      hand.splice(i, 1);
      st.discard.push(card);
      st.color = card.c >= 0 ? card.c : chosenColor;
      st.phase = 'play'; st.drawnI = -1;

      const name = this.nameOf(who);
      // UNO 喊牌判定（2 → 1）
      let vulnerable = false;
      if (hand.length === 1) {
        if (st.declared[who]) {
          st.declared[who] = false;
          st.msg = name + ' 喊出了 UNO！';
          this.fx('uno');
        } else {
          vulnerable = true;
          st.catchSeat = who;
          st.msg = name + ' 只剩 1 张牌却没喊 UNO？下家可以举报！';
        }
      } else if (hand.length > 2) {
        st.declared[who] = false;
      }

      if (hand.length === 0) {
        st.over = true; st.winner = who;
        st.catchSeat = -1; st.catchBy = -1;
        st.msg = name + ' 出完了所有手牌！';
        return true;
      }

      let steps = 1;
      if (card.v === SKIP) {
        steps = 2; this.fx('action');
        if (hand.length !== 1) st.msg = name + ' 打出跳过，' + this.nameOf(this.nextSeat(who)) + ' 停牌一轮';
      } else if (card.v === REV) {
        st.dir *= -1;
        steps = this.n === 2 ? 2 : 1;
        this.fx('action');
        if (hand.length !== 1) st.msg = name + ' 打出反转，方向调转';
      } else if (card.v === D2) {
        const t = this.nextSeat(who);
        this.drawCards(t, 2, true);
        st.declared[t] = false;
        steps = 2; this.fx('action');
        st.msg = name + ' 打出 +2，' + this.nameOf(t) + ' 罚摸 2 张并跳过';
      } else if (card.v === W4) {
        const t = this.nextSeat(who);
        this.drawCards(t, 4, true);
        st.declared[t] = false;
        steps = 2; this.fx('action');
        st.msg = name + ' 打出 +4，' + this.nameOf(t) + ' 罚摸 4 张并跳过';
      } else if (card.c < 0) {
        this.fx('action');
        if (hand.length !== 1) st.msg = name + ' 打出变色，指定 ' + COLOR_NAME[st.color];
      } else {
        this.fx('play');
      }
      st.turn = this.advanceFrom(who, steps);
      if (vulnerable) st.catchBy = st.turn; // 由下一个实际行动的玩家举报
      return true;
    }

    humanDraw(who) {
      const st = this.st;
      if (st.over || st.turn !== who || st.phase !== 'play') return false;
      this.clearCatchIfActor(who);
      const got = this.drawCards(who, 1);
      if (!got.length) { st.turn = this.advanceFrom(who, 1); return true; }
      st.declared[who] = false;
      const card = got[0];
      if (this.playable(card)) {
        st.phase = 'choice';
        st.drawnI = st.hands[who].length - 1;
        st.msg = this.nameOf(who) + ' 摸到一张可出的牌';
      } else {
        st.turn = this.advanceFrom(who, 1);
        st.msg = this.nameOf(who) + ' 摸牌后仍无牌可出，跳过';
      }
      return true;
    }

    pass(who) {
      const st = this.st;
      if (st.over || st.turn !== who || st.phase !== 'choice') return false;
      this.clearCatchIfActor(who);
      st.phase = 'play'; st.drawnI = -1;
      st.turn = this.advanceFrom(who, 1);
      st.msg = this.nameOf(who) + ' 选择不出，跳过';
      return true;
    }

    declareUno(who) {
      const st = this.st;
      if (st.over) return false;
      if (st.hands[who].length !== 2 || st.declared[who]) return false;
      st.declared[who] = true;
      this.fx('uno');
      st.msg = this.nameOf(who) + ' 喊了 UNO！';
      return true;
    }

    doCatch(by) {
      const st = this.st;
      if (st.over || st.catchSeat < 0 || st.catchBy !== by) return false;
      const target = st.catchSeat;
      st.catchSeat = -1; st.catchBy = -1;
      this.drawCards(target, 2, true);
      st.declared[target] = false;
      this.fx('catch');
      st.msg = this.nameOf(by) + ' 举报成功，' + this.nameOf(target) + ' 忘喊 UNO 罚摸 2 张';
      return true;
    }

    pickStartColor(who, color) {
      const st = this.st;
      if (st.over || st.phase !== 'pickstart' || who !== 0) return false;
      st.color = color;
      st.phase = 'play';
      st.msg = '起始颜色定为 ' + COLOR_NAME[color] + '，轮到 ' + this.nameOf(0);
      this.fx('play');
      return true;
    }

    afterAction() {
      this.pushViews();
      this.render();
      this.pump();
    }

    /* ==================== AI ==================== */
    pump() {
      if (this.dead || this.st.over) return;
      const st = this.st;
      if (st.phase === 'pickstart') {
        if (this.players[0].kind === 'ai') {
          this.delay(() => { this.pickStartColor(0, this.aiColor(0)); this.afterAction(); }, 700);
        }
        return; // 人类先手选色时等待
      }
      const seat = st.turn;
      if (this.players[seat].kind !== 'ai') return;
      this.delay(() => this.aiTurn(seat), 650 + Math.random() * 550);
    }

    aiTurn(seat) {
      if (this.dead || this.st.over) return;
      const st = this.st;
      if (st.turn !== seat) return;

      // AI 作为下家可以举报
      if (st.catchSeat >= 0 && st.catchBy === seat) {
        const p = this.diff === 1 ? 0.5 : 0.9;
        if (Math.random() < p) this.doCatch(seat);
        else { st.catchSeat = -1; st.catchBy = -1; }
      }

      if (st.phase === 'choice') {
        const playIt = this.diff === 1 ? Math.random() < 0.55 : this.aiWantPlayDrawn(seat);
        if (playIt) this.commitAiCard(seat, st.drawnI);
        else this.pass(seat);
        this.afterAction();
        return;
      }
      if (st.phase !== 'play') return;

      const hand = st.hands[seat];
      const idxs = [];
      for (let i = 0; i < hand.length; i++) {
        if (!this.playable(hand[i])) continue;
        if (hand[i].v === W4 && !this.canW4(hand, i)) continue;
        idxs.push(i);
      }
      if (!idxs.length) {
        this.humanDraw(seat);
        this.afterAction();
        return;
      }
      // 打出倒数第二张前先喊 UNO（简单 80% / 普通 95% 记得喊）
      if (hand.length === 2) {
        const remember = this.diff === 1 ? 0.8 : 0.95;
        if (Math.random() < remember) st.declared[seat] = true;
      }
      const pick = this.diff === 1 ? idxs[Math.floor(Math.random() * idxs.length)] : this.aiPick(seat, idxs);
      this.commitAiCard(seat, pick);
      this.afterAction();
    }

    commitAiCard(seat, i) {
      const card = this.st.hands[seat][i];
      const color = card.c < 0 ? this.aiColor(seat) : -1;
      this.commitPlay(seat, i, color);
    }

    aiColor(seat) {
      const hand = this.st.hands[seat];
      const cnt = [0, 0, 0, 0];
      hand.forEach(c => { if (c.c >= 0) cnt[c.c]++; });
      let best = 0;
      for (let c = 1; c < 4; c++) if (cnt[c] > cnt[best]) best = c;
      return best;
    }

    aiWantPlayDrawn(seat) { return true; }

    aiPick(seat, idxs) {
      const st = this.st, hand = st.hands[seat];
      const nextN = st.hands[this.nextSeat(seat)].length;
      let best = idxs[0], bestS = -1e9;
      for (const i of idxs) {
        const c = hand[i];
        let s = Math.random() * 3;
        if (c.v === W4) s += (hand.length <= 3 || nextN <= 3) ? 70 : 4;
        else if (c.v === WILD) s += hand.length <= 3 ? 40 : 6;
        else if (c.v === D2) s += 12 + (nextN <= 4 ? 50 : 0);
        else if (c.v === SKIP || c.v === REV) s += 10 + (nextN <= 3 ? 45 : 0);
        else s += 20 - c.v * 0.3 + (c.c === st.color ? 6 : 0);
        if (hand.length <= 4 && c.c >= 0) s *= 1.3;
        if (s > bestS) { bestS = s; best = i; }
      }
      return best;
    }

    /* ==================== 联机：房主 ==================== */
    bindHost() {
      const room = this.room;
      this._unsub.push(room.on('data', (msg, seat) => {
        if (this.dead || !msg) return;
        if (seat == null) seat = 1; // 手动信令两人局
        if (seat <= 0 || seat >= this.n) return;
        this.onRemote(msg, seat);
      }));
      this._unsub.push(room.on('leave', seat => {
        if (this.dead || seat == null || seat <= 0 || seat >= this.n) return;
        // 断线玩家由 AI 托管，牌局继续
        if (this.players[seat].kind === 'net') {
          this.players[seat].kind = 'ai';
          this.players[seat].name += '（离线·AI）';
          this.toast(this.players[seat].name.replace('（离线·AI）', '') + ' 已离开，由 AI 接管');
          if (!this.st.over) this.afterAction();
        }
      }));
    }

    onRemote(msg, seat) {
      const st = this.st;
      switch (msg.t) {
        case 'p':
          if (st.turn === seat && (st.phase === 'play' || st.phase === 'choice')) {
            this.commitPlay(seat, msg.i | 0, msg.color == null ? -1 : msg.color | 0);
            this.afterAction();
          }
          break;
        case 'd':
          if (this.humanDraw(seat)) this.afterAction();
          break;
        case 'n':
          if (this.pass(seat)) this.afterAction();
          break;
        case 'u':
          if (this.declareUno(seat)) this.afterAction();
          break;
        case 'catch':
          if (this.doCatch(seat)) this.afterAction();
          break;
        case 'c':
          if (this.pickStartColor(seat, msg.color | 0)) this.afterAction();
          break;
        case 'again':
          if (st.over) { this.newGame(); this.render(); this.pump(); }
          break;
      }
    }

    makeView(seat) {
      const st = this.st;
      return {
        seat: seat, n: this.n,
        names: this.players.map((p, i) => i === seat ? '你' : p.name),
        kinds: this.players.map(p => p.kind),
        hand: st.hands[seat],
        counts: st.hands.map(h => h.length),
        top: st.discard[st.discard.length - 1],
        color: st.color, turn: st.turn, dir: st.dir,
        phase: st.turn === seat ? st.phase : 'play',
        drawnI: (st.turn === seat && st.phase === 'choice') ? st.drawnI : -1,
        catchSeat: st.catchSeat, catchBy: st.catchBy,
        over: st.over, winner: st.winner,
        msg: st.msg, declared: st.declared[seat],
        fx: st.fx, deckN: st.deck.length
      };
    }

    pushViews() {
      if (this.netRole !== 'host') return;
      const canDirect = typeof this.room.sendTo === 'function';
      for (let s = 1; s < this.n; s++) {
        if (this.players[s].kind !== 'net') continue;
        const msg = { t: 's', view: this.makeView(s) };
        if (canDirect) this.room.sendTo(s, msg);
        else this.room.send(msg); // 手动信令两人局：单连接直接发
      }
    }

    /* ==================== 联机：客户端 ==================== */
    bindGuest() {
      const room = this.room;
      this.view = null;
      this._unsub.push(room.on('data', msg => {
        if (this.dead || !msg) return;
        if (msg.t === 's') {
          this.view = msg.view;
          this.playGuestFx();
          this.render();
        }
      }));
    }

    playGuestFx() {
      const v = this.view;
      if (!v || !v.fx) return;
      if (v.fx.seq > this.lastFxSeq) {
        this.lastFxSeq = v.fx.seq;
        if (v.fx.kind) Snd.play(v.fx.kind);
      }
    }

    renderWaiting() {
      this.mount.innerHTML =
        '<p class="text-center text-xs text-slate-500 py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>正在同步牌局数据…</p>';
    }

    /* ==================== 本地 / 客端统一动作入口 ==================== */
    actPlay(i, color) {
      if (this.netRole === 'guest') this.room.send({ t: 'p', i: i, color: color == null ? -1 : color });
      else { this.commitPlay(this.mySeat, i, color == null ? -1 : color); this.afterAction(); }
    }
    actDraw() {
      if (this.netRole === 'guest') this.room.send({ t: 'd' });
      else { this.humanDraw(this.mySeat); this.afterAction(); }
    }
    actPass() {
      if (this.netRole === 'guest') this.room.send({ t: 'n' });
      else { this.pass(this.mySeat); this.afterAction(); }
    }
    actUno() {
      if (this.netRole === 'guest') this.room.send({ t: 'u' });
      else { this.declareUno(this.mySeat); this.afterAction(); }
    }
    actCatch() {
      if (this.netRole === 'guest') this.room.send({ t: 'catch' });
      else { this.doCatch(this.mySeat); this.afterAction(); }
    }
    actPickColor(color) {
      if (this.pendingPick >= 0) {
        const i = this.pendingPick;
        this.pendingPick = -1;
        this.actPlay(i, color);
        return;
      }
      // 起始变色选色
      if (this.netRole === 'guest') this.room.send({ t: 'c', color: color });
      else { this.pickStartColor(this.mySeat, color); this.afterAction(); }
    }
    actAgain() {
      if (this.netRole === 'guest') {
        this.room.send({ t: 'again' });
        this.toast('已请求再来一局，等待房主确认');
      } else {
        this.newGame();
        this.render();
        this.pump();
      }
    }

    /* ==================== 渲染 ==================== */
    currentView() {
      if (this.netRole === 'guest') return this.view;
      return this.makeView(this.mySeat);
    }

    guestPlayable(card, v) {
      if (card.c < 0) return true;
      return card.c === v.color || card.v === v.top.v;
    }

    handleClick(e) {
      const el = e.target.closest('[data-uno]');
      if (!el) return;
      const act = el.dataset.uno;
      const v = this.currentView();
      if (!v) return;
      switch (act) {
        case 'card': {
          const i = Number(el.dataset.i);
          if (v.over || v.turn !== v.seat) return;
          if (v.phase === 'choice' && i !== v.drawnI) return;
          if (v.phase !== 'play' && v.phase !== 'choice') return;
          const card = v.hand[i];
          if (!card || !this.guestPlayable(card, v)) return;
          if (card.c < 0) {
            this.pendingPick = i;
            this.render();
          } else {
            this.actPlay(i, -1);
          }
          break;
        }
        case 'draw':  if (!v.over && v.turn === v.seat && v.phase === 'play') this.actDraw(); break;
        case 'pass':  if (!v.over && v.turn === v.seat && v.phase === 'choice') this.actPass(); break;
        case 'uno':   this.actUno(); break;
        case 'catch': this.actCatch(); break;
        case 'color': this.actPickColor(Number(el.dataset.color)); break;
        case 'cancelpick': this.pendingPick = -1; this.render(); break;
        case 'again': this.actAgain(); break;
        case 'exit': {
          const btn = document.getElementById('game-leave');
          if (btn) btn.click();
          break;
        }
        case 'snd':
          Snd.on = !Snd.on;
          if (Snd.on) Snd.play('play');
          this.render();
          break;
      }
    }

    cardHtml(card, cls, attrs) {
      return `<button class="uno-card ${cls || ''}" style="background:${cardBg(card)}" ${attrs || ''}>
        <span class="ccorner">${cardSym(card)}</span><span class="csym">${cardSym(card)}</span></button>`;
    }

    render() {
      const v = this.currentView();
      if (!v) { this.renderWaiting(); return; }
      const me = v.seat;
      const myTurn = v.turn === me && !v.over;

      /* ---------- 对手条 ---------- */
      let oppHtml = '';
      for (let i = 0; i < v.n; i++) {
        if (i === me) continue;
        const isTurn = v.turn === i && !v.over;
        const icon = v.kinds[i] === 'ai' ? 'fa-robot' : 'fa-user';
        const unoTag = v.counts[i] === 1
          ? '<span class="text-[9px] px-1.5 py-px rounded-full bg-rose-400/20 border border-rose-300/40 text-rose-200 font-bold">UNO</span>' : '';
        const catchBtn = (v.catchSeat === i && v.catchBy === me && !v.over)
          ? `<button data-uno="catch" class="uno-pulse mt-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/50 text-amber-200 font-bold">举报!</button>` : '';
        let backs = '';
        const showN = Math.min(v.counts[i], 7);
        for (let k = 0; k < showN; k++) backs += '<span class="uno-card mini back" style="margin-left:' + (k ? '-0.85rem' : '0') + '"></span>';
        oppHtml += `
          <div class="uno-badge ${isTurn ? 'turn' : ''} flex flex-col items-center px-2.5 py-1.5 rounded-xl border border-white/10 bg-white/5 flex-none">
            <span class="text-[10.5px] text-slate-300 max-w-[4.6rem] truncate"><i class="fa-solid ${icon} text-cyan-300/70 mr-0.5"></i>${v.names[i]}</span>
            <span class="flex items-center mt-1 h-8">${backs || '<span class="text-[10px] text-slate-500">0 张</span>'}</span>
            <span class="text-[10px] text-slate-400">${v.counts[i]} 张 ${unoTag}</span>
            ${catchBtn}
          </div>`;
      }

      /* ---------- 中央区 ---------- */
      const topCard = v.top;
      const dirIcon = v.dir === 1 ? 'fa-rotate-right' : 'fa-rotate-left';
      const turnText = v.over
        ? (v.winner === me ? '🎉 你赢了！' : v.names[v.winner] + ' 获胜')
        : (myTurn ? '轮到你出牌' : '等待 ' + v.names[v.turn] + ' 出牌');
      const drawActive = myTurn && v.phase === 'play';
      const centerRight = v.phase === 'pickstart' && v.turn === me && !v.over
        ? `<div class="text-center">
             <p class="text-[11px] text-amber-200 mb-2">首张为变色牌，请选择起始颜色</p>
             <div class="flex gap-2 justify-center">
               ${[0, 1, 2, 3].map(c => `<button data-uno="color" data-color="${c}" class="w-9 h-9 rounded-full border-2 border-white/70 shadow-lg" style="background:${COLOR_HEX[c]}"></button>`).join('')}
             </div>
           </div>`
        : `<div class="text-center px-2">
             <p class="text-xs text-slate-300"><i class="fa-solid ${dirIcon} text-cyan-300/80 mr-1"></i>${turnText}</p>
             <p class="text-[11px] text-cyan-200/80 mt-1 min-h-[1rem]">${v.msg || ''}</p>
           </div>`;

      /* ---------- 我的手牌 ---------- */
      let handHtml = '';
      v.hand.forEach((card, i) => {
        let cls = '';
        if (v.over || !myTurn || (v.phase !== 'play' && v.phase !== 'choice')) cls = 'dim';
        else if (v.phase === 'choice') cls = (i === v.drawnI) ? 'playable uno-sel' : 'dim';
        else cls = this.guestPlayable(card, v) ? 'playable' : 'dim';
        handHtml += this.cardHtml(card, cls, `data-uno="card" data-i="${i}"`);
      });

      const canUno = !v.over && v.hand.length === 2 && !v.declared;
      const unoBtn = v.declared
        ? '<button class="btn-ghost text-amber-200 border-amber-300/40" disabled><i class="fa-solid fa-check"></i>已喊 UNO</button>'
        : `<button data-uno="uno" class="${canUno ? 'uno-pulse' : ''} text-[12.5px] px-4 py-1.5 rounded-full font-bold border transition-all
             ${canUno ? 'bg-amber-400/25 border-amber-300/60 text-amber-100' : 'bg-white/5 border-white/10 text-slate-500'}">UNO!</button>`;
      const passBtn = (myTurn && v.phase === 'choice')
        ? '<button data-uno="pass" class="btn-ghost"><i class="fa-solid fa-forward-step"></i>不要</button>' : '';
      const catchBtnMain = (v.catchSeat >= 0 && v.catchBy === me && !v.over)
        ? `<button data-uno="catch" class="uno-pulse text-[12.5px] px-4 py-1.5 rounded-full font-bold bg-amber-400/25 border border-amber-300/60 text-amber-100"><i class="fa-solid fa-flag mr-1"></i>举报 ${v.names[v.catchSeat]}!</button>` : '';

      /* ---------- 结算弹层 ---------- */
      let overHtml = '';
      if (v.over) {
        const win = v.winner === me;
        if (!this._overFxDone) {
          this._overFxDone = true;
          Snd.play(win ? 'win' : 'lose');
        }
        const summary = v.counts.map((c, i) =>
          `<span class="text-[10.5px] px-2 py-0.5 rounded-full ${i === v.winner ? 'bg-amber-400/20 text-amber-200 border border-amber-300/40' : 'bg-white/5 text-slate-400 border border-white/10'}">${v.names[i]} ${i === v.winner ? '胜出' : '剩 ' + c + ' 张'}</span>`
        ).join('');
        overHtml = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(2,6,23,.72);backdrop-filter:blur(4px)">
            <div class="glass-card panel-card w-full max-w-sm p-6 text-center">
              <p class="text-4xl mb-2">${win ? '🎉' : '😢'}</p>
              <p class="text-lg font-bold ${win ? 'text-amber-300' : 'text-slate-200'}">${win ? '你赢了！' : v.names[v.winner] + ' 获胜'}</p>
              <div class="flex flex-wrap justify-center gap-1.5 my-4">${summary}</div>
              <div class="flex gap-2 justify-center">
                <button data-uno="again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
                <button data-uno="exit" class="btn-ghost"><i class="fa-solid fa-arrow-left-long"></i>返回大厅</button>
              </div>
            </div>
          </div>`;
      }

      /* ---------- 选色弹层 ---------- */
      let pickHtml = '';
      if (this.pendingPick >= 0 && !v.over) {
        pickHtml = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(2,6,23,.6);backdrop-filter:blur(3px)">
            <div class="glass-card panel-card w-full max-w-xs p-5 text-center">
              <p class="text-sm font-semibold text-slate-100 mb-3">选择要变成的颜色</p>
              <div class="flex gap-3 justify-center mb-4">
                ${[0, 1, 2, 3].map(c => `<button data-uno="color" data-color="${c}" class="w-11 h-11 rounded-full border-2 border-white/70 shadow-lg active:scale-95 transition" style="background:${COLOR_HEX[c]}" title="${COLOR_NAME[c]}"></button>`).join('')}
              </div>
              <button data-uno="cancelpick" class="btn-ghost"><i class="fa-solid fa-xmark"></i>取消</button>
            </div>
          </div>`;
      }

      this.mount.innerHTML = `
        <div class="space-y-3 select-none">
          <div class="flex gap-2 overflow-x-auto pb-1 uno-scroll justify-start sm:justify-center">${oppHtml}</div>

          <div class="glass-card panel-card p-3 sm:p-4">
            <div class="flex items-center justify-center gap-4 sm:gap-8">
              <div class="flex flex-col items-center gap-1">
                <button data-uno="draw" class="uno-card back ${drawActive ? 'playable' : 'dim'}" ${drawActive ? '' : 'disabled'}>
                  <span class="csym" style="font-size:1rem">UNO</span>
                </button>
                <span class="text-[10px] text-slate-400">牌堆 ${v.deckN}</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                ${this.cardHtml(topCard, 'big', 'disabled')}
                <span class="text-[10px] text-slate-400 flex items-center gap-1">当前颜色
                  <span class="inline-block w-2.5 h-2.5 rounded-full border border-white/60" style="background:${v.color >= 0 ? COLOR_HEX[v.color] : '#64748b'}"></span>
                  ${v.color >= 0 ? COLOR_NAME[v.color] : '—'}
                </span>
              </div>
              ${centerRight}
            </div>
          </div>

          <div class="glass-card panel-card p-3 sm:p-4">
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <p class="text-[11px] text-slate-400"><i class="fa-solid fa-hand text-cyan-300/70 mr-1"></i>你的手牌（${v.hand.length} 张）</p>
              <div class="flex items-center gap-2">
                ${catchBtnMain}
                ${passBtn}
                ${unoBtn}
                <button data-uno="snd" class="btn-ghost !px-2.5" title="音效开关">
                  <i class="fa-solid ${Snd.on ? 'fa-volume-high' : 'fa-volume-xmark'}"></i>
                </button>
              </div>
            </div>
            <div class="flex gap-1.5 overflow-x-auto pb-1 uno-scroll">${handHtml}</div>
          </div>
        </div>
        ${overHtml}
        ${pickHtml}`;
    }
  }

  /* ---------------- 模块出口（与其他游戏同构） ---------------- */
  window.GG = window.GG || {};
  window.GG.uno = {
    _inst: null,
    start(mount, opts) {
      this.stop();
      this._inst = new Uno(mount, opts);
    },
    stop() {
      if (this._inst) { this._inst.destroy(); this._inst = null; }
    }
  };
})();
