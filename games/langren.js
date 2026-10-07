/* ==================================================================
 * 狼人杀（8-10 人 · 仅 WebRTC 联机 · 无 AI）
 *  角色自动分配：8-9 人 2 狼；10 人 3 狼；预言家、女巫各 1，其余村民
 *  流程：夜晚（狼人刀人 → 预言家查验 → 女巫用药）→ 白天（轮流发言 → 投票放逐）
 *  信令（房主权威）：
 *    客→主  {t:'chat',x} {t:'wolf',tgt} {t:'check',tgt} {t:'witch',save,poison}
 *            {t:'done'} {t:'vote',tgt} {t:'again'}
 *    主→客  {t:'s',view}  {t:'chat',from,name,x,sys,wolf(是否狼频道)}
 *  夜晚禁言：普通玩家无法聊天；存活狼人共享狼频道密聊。
 * ================================================================== */
(function () {
  'use strict';

  const ROLES = {
    wolf:     { name: '狼人',   emoji: '🐺', team: 'wolf', desc: '夜晚与狼同伴共同猎杀一名玩家；白天隐藏身份，误导好人。' },
    seer:     { name: '预言家', emoji: '🔮', team: 'good', desc: '每晚可查验一名玩家的阵营（好人 / 狼人）。' },
    witch:    { name: '女巫',   emoji: '⚗️', team: 'good', desc: '拥有解药与毒药各一瓶，每晚最多用一瓶；解药未用时可知晓当晚遇害者。' },
    villager: { name: '村民',   emoji: '👨‍🌾', team: 'good', desc: '没有特殊技能，靠白天发言与投票找出所有狼人。' }
  };

  /* ---------------- 音效 ---------------- */
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
        case 'night': this.tone(196, .5, 'sine', .12, 0); this.tone(147, .6, 'sine', .1, .18); break;
        case 'day':   [523, 659, 784].forEach((f, i) => this.tone(f, .13, 'triangle', .14, i * .1)); break;
        case 'act':   this.tone(720, .08, 'triangle', .12, 0); break;
        case 'out':   this.tone(300, .14, 'sawtooth', .1, 0); this.tone(210, .2, 'sawtooth', .1, .12); break;
        case 'win':   [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .15, 'triangle', .18, i * .11)); break;
        case 'lose':  [392, 330, 262, 196].forEach((f, i) => this.tone(f, .17, 'sine', .15, i * .13)); break;
      }
    }
  };
  document.addEventListener('pointerdown', () => Snd.ensure(), { passive: true });

  /* ---------------- 样式 ---------------- */
  const CSS = `
    .lr-wrap{display:flex;flex-direction:column;gap:.6rem}
    .lr-cols{display:flex;flex-direction:column;gap:.6rem;min-width:0}
    .lr-chatpanel{display:flex;flex-direction:column;min-width:0}
    .lr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem}
    @media(min-width:560px){.lr-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    .lr-pcard{border-radius:.8rem;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);
      padding:.55rem .6rem;display:flex;flex-direction:column;gap:.3rem;transition:all .2s ease;min-width:0}
    .lr-pcard.turn{border-color:rgba(103,232,249,.6);background:rgba(103,232,249,.1);box-shadow:0 0 12px rgba(103,232,249,.15)}
    .lr-pcard.dead{opacity:.55;filter:saturate(.5)}
    .lr-pcard.pick{border-color:rgba(251,191,36,.55);background:rgba(251,191,36,.08)}
    .lr-pcard.mate{border-color:rgba(244,63,94,.4)}
    .lr-name{font-size:11.5px;color:#e2e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lr-tag{font-size:9.5px;padding:1px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.16);color:#cbd5e1;white-space:nowrap}
    .lr-tag.speak{background:rgba(103,232,249,.16);border-color:rgba(103,232,249,.5);color:#a5f3fc}
    .lr-tag.donetag{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.45);color:#6ee7b7}
    .lr-tag.deadt{background:rgba(244,63,94,.14);border-color:rgba(244,63,94,.4);color:#fda4af}
    .lr-tag.roleT{background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.45);color:#fcd34d}
    .lr-tag.wolfT{background:rgba(244,63,94,.16);border-color:rgba(244,63,94,.5);color:#fda4af}
    .lr-tag.goodT{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.45);color:#6ee7b7}
    .lr-tag.checkg{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.45);color:#6ee7b7}
    .lr-tag.checkw{background:rgba(244,63,94,.16);border-color:rgba(244,63,94,.5);color:#fda4af}
    .lr-actbtn{font-size:10.5px;padding:3px 0;border-radius:.55rem;background:rgba(103,232,249,.1);
      border:1px solid rgba(103,232,249,.35);color:#a5f3fc;cursor:pointer;transition:all .15s ease;width:100%}
    .lr-actbtn:hover{background:rgba(103,232,249,.22)}
    .lr-actbtn.mine{background:rgba(251,191,36,.2);border-color:rgba(251,191,36,.6);color:#fde68a}
    .lr-actbtn.kill{background:rgba(244,63,94,.12);border-color:rgba(244,63,94,.45);color:#fda4af}
    .lr-rolecard{display:inline-flex;align-items:center;gap:.45rem;padding:.4rem .9rem;border-radius:.9rem;
      background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.35);color:#e2e8f0;font-weight:700;font-size:13.5px;cursor:pointer}
    .lr-rolecard.wolfc{background:rgba(244,63,94,.1);border-color:rgba(244,63,94,.45);color:#fecdd3}
    .lr-chatlog{height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:.3rem;
      border:1px solid rgba(255,255,255,.08);border-radius:.8rem;background:rgba(2,6,23,.4);padding:8px}
    .lr-chatlog::-webkit-scrollbar{width:5px}
    .lr-chatlog::-webkit-scrollbar-thumb{background:rgba(103,232,249,.25);border-radius:3px}
    .lr-msg{font-size:11.5px;line-height:1.55;word-break:break-word;color:#e2e8f0}
    .lr-msg b{color:#67e8f9;font-weight:600;margin-right:.3rem}
    .lr-msg.sys{text-align:center;color:#94a3b8;font-size:10.5px}
    .lr-msg.wolfc b{color:#fda4af}
    .lr-msg.wolfc{background:rgba(244,63,94,.06);border-radius:.4rem;padding:1px 5px}
    .lr-msg.me b{color:#fcd34d}
    .lr-inputrow{display:flex;gap:.45rem;margin-top:.45rem}
    .lr-input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(148,197,255,.16);
      color:#e2e8f0;border-radius:.7rem;padding:.5rem .7rem;font-size:12.5px}
    .lr-input:focus{outline:none;border-color:rgba(103,232,249,.5)}
    .lr-send{flex:none}
    @media(min-width:780px){
      .lr-cols{flex-direction:row;align-items:stretch}
      .lr-side{flex:1;min-width:0}
      .lr-chatpanel{width:340px;flex:none}
      .lr-chatlog{flex:1;height:auto;min-height:230px}
    }
    body.orient-land #game-mount .lr-cols{flex-direction:row;align-items:stretch}
    body.orient-land #game-mount .lr-chatpanel{width:290px;flex:none}
    body.orient-land #game-mount .lr-chatlog{height:auto;max-height:calc(100vh - 220px);max-height:calc(100dvh - 220px)}
  `;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ==================================================================
   * 主类（房主权威）
   * ================================================================== */
  class Langren {
    constructor(mount, opts) {
      this.mount = mount;
      this.toast = opts.toast || function () {};
      this.isNet = opts.mode === 'net';
      this.mySeat = opts.seat || 0;
      this.room = opts.room || null;
      this.dead = false;
      this.timers = [];
      this._unsub = [];
      this.chat = [];
      this.lastFxSeq = 0;
      this._overFxDone = false;
      this.showRole = false;         // 身份卡防偷窥
      this._wasInputFocus = false;
      // 女巫本地暂选（确认前可反悔）
      this.selSave = false;
      this.selPoison = -1;

      if (!document.getElementById('lr-style')) {
        const st = document.createElement('style');
        st.id = 'lr-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      }

      if (!this.isNet) {
        this.mount.innerHTML =
          '<p class="text-center text-xs text-amber-200 py-10 glass-card p-6">狼人杀为纯联机派对游戏（无 AI）。<br>请在大厅选择「联机对战」，创建房间邀请 7 位以上好友加入。</p>';
        return;
      }

      this.n = Math.max(8, Math.min(10, opts.count || 8));
      this.netRole = this.mySeat === 0 ? 'host' : 'guest';
      this.players = [];
      for (let i = 0; i < this.n; i++) this.players.push({ name: i === 0 ? '房主' : '玩家 ' + (i + 1) });

      this._onClick = e => this.handleClick(e);
      this._onKey = e => {
        if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('lr-input')) {
          e.preventDefault();
          this.sendChat();
        }
      };
      this.mount.addEventListener('click', this._onClick);
      this.mount.addEventListener('keydown', this._onKey);

      if (this.netRole === 'guest') {
        this.bindGuest();
        this.renderWaiting();
      } else {
        this.bindHost();
        this.newGame();
        this.render();
      }
    }

    /* ==================== 生命周期 ==================== */
    destroy() {
      this.dead = true;
      this.timers.forEach(clearTimeout);
      this._unsub.forEach(un => { try { un(); } catch (e) {} });
      this.mount.removeEventListener('click', this._onClick);
      this.mount.removeEventListener('keydown', this._onKey);
      this.mount.innerHTML = '';
    }

    nameOf(s) {
      if (s === this.mySeat) return '你';
      return this.players[s] ? this.players[s].name : '玩家 ' + (s + 1);
    }
    roleName(r) { return ROLES[r] ? ROLES[r].name : r; }

    fx(kind) {
      this.st.fx = { seq: this.st.fx.seq + 1, kind: kind };
      if (this.netRole !== 'guest') Snd.play(kind);
    }

    /* ==================== 开局（仅房主） ==================== */
    newGame() {
      const wolves = this.n >= 10 ? 3 : 2;
      const roles = new Array(this.n).fill('villager');
      const idx = shuffle(Array.from({ length: this.n }, (_, i) => i));
      let p = 0;
      for (let k = 0; k < wolves; k++) roles[idx[p++]] = 'wolf';
      roles[idx[p++]] = 'seer';
      roles[idx[p++]] = 'witch';

      this.st = {
        roles: roles,
        alive: new Array(this.n).fill(true),
        phase: 'night-wolf',     // night-wolf | night-check | night-witch | dawn? -> day-talk | day-vote | over
        day: 1,
        wolfVotes: {},           // wolfSeat -> target
        killTarget: -1, saved: false, poisonTarget: -1,
        witchSaveUsed: false, witchPoisonUsed: false, witchUsedTonight: false,
        checkLog: {},            // seat -> 'good' | 'wolf'（仅预言家可见）
        speakTurn: 0, spoken: new Array(this.n).fill(false),
        talkCursor: this.n - 1,  // 白天发言轮转锚点
        votes: {}, lastVotes: null,
        nightDeaths: [],
        over: false, winner: '', // 'good' | 'wolf'
        reveal: {},              // seat -> role
        msg: '', fx: { seq: 0, kind: '' }
      };
      this._overFxDone = false;
      this.sysChat('游戏开始！' + this.n + ' 人局：' + wolves + ' 狼人 · 预言家 · 女巫 · ' + (this.n - wolves - 2) + ' 村民');
      this.startNight();
    }

    aliveList() {
      const out = [];
      for (let i = 0; i < this.n; i++) if (this.st.alive[i]) out.push(i);
      return out;
    }
    aliveOf(role) { return this.aliveList().filter(s => this.st.roles[s] === role); }
    aliveWolves() { return this.aliveOf('wolf'); }
    aliveGood() { return this.aliveList().filter(s => this.st.roles[s] !== 'wolf'); }
    nextAlive(from) {
      for (let k = 1; k <= this.n; k++) {
        const s = (from + k) % this.n;
        if (this.st.alive[s]) return s;
      }
      return from;
    }
    isNight() { return this.st.phase.indexOf('night') === 0; }

    /* ==================== 夜晚 ==================== */
    startNight() {
      const st = this.st;
      st.phase = 'night-wolf';
      st.wolfVotes = {};
      st.killTarget = -1; st.saved = false; st.poisonTarget = -1;
      st.witchUsedTonight = false;
      this.fx('night');
      const wolves = this.aliveWolves();
      if (!wolves.length) { this.toWitch(); return; }
      st.msg = '夜幕降临，狼人请睁眼——选择今晚的猎物（' + wolves.length + ' 名狼人需全部确认）';
      this.sysChat('🌙 第 ' + st.day + ' 个夜晚降临，所有人闭眼…');
      this.pushRender();
    }

    doWolf(seat, tgt) {
      const st = this.st;
      if (st.over || st.phase !== 'night-wolf' || !st.alive[seat] || st.roles[seat] !== 'wolf') return;
      if (!st.alive[tgt] || st.roles[tgt] === 'wolf') return;
      st.wolfVotes[seat] = tgt;
      const wolves = this.aliveWolves();
      const done = wolves.filter(s => st.wolfVotes[s] !== undefined);
      if (done.length < wolves.length) {
        st.msg = '狼人行动中（' + done.length + '/' + wolves.length + ' 已确认）';
        this.pushRender();
        return;
      }
      st.killTarget = st.wolfVotes[wolves[0]];
      this.toCheck();
    }

    toCheck() {
      const st = this.st;
      if (this.aliveOf('seer').length) {
        st.phase = 'night-check';
        st.msg = '狼人已行动，预言家请睁眼——查验一名玩家';
        this.pushRender();
      } else {
        this.toWitch();
      }
    }

    doCheck(seat, tgt) {
      const st = this.st;
      if (st.over || st.phase !== 'night-check' || st.roles[seat] !== 'seer' || !st.alive[seat]) return;
      if (!st.alive[tgt] || tgt === seat) return;
      st.checkLog[tgt] = st.roles[tgt] === 'wolf' ? 'wolf' : 'good';
      this.fx('act');
      this.toWitch();
    }

    toWitch() {
      const st = this.st;
      if (this.aliveOf('witch').length) {
        st.phase = 'night-witch';
        st.msg = '女巫请睁眼——选择使用药剂，或直接跳过（每晚限一瓶）';
        this.pushRender();
      } else {
        this.dawn();
      }
    }

    doWitch(seat, useSave, poisonTgt) {
      const st = this.st;
      if (st.over || st.phase !== 'night-witch' || st.roles[seat] !== 'witch' || !st.alive[seat]) return;
      if (useSave && !st.witchSaveUsed && st.killTarget >= 0 && !st.witchUsedTonight) {
        st.saved = true;
        st.witchSaveUsed = true;
        st.witchUsedTonight = true;
      } else if (poisonTgt >= 0 && !st.witchPoisonUsed && !st.witchUsedTonight) {
        if (!st.alive[poisonTgt] || poisonTgt === seat) return;
        st.poisonTarget = poisonTgt;
        st.witchPoisonUsed = true;
        st.witchUsedTonight = true;
      }
      this.dawn();
    }

    dawn() {
      const st = this.st;
      const deaths = [];
      if (st.killTarget >= 0 && !st.saved) deaths.push(st.killTarget);
      if (st.poisonTarget >= 0 && deaths.indexOf(st.poisonTarget) < 0) deaths.push(st.poisonTarget);
      st.nightDeaths = deaths.filter(s => st.alive[s]);
      st.nightDeaths.forEach(s => {
        st.alive[s] = false;
        st.reveal[s] = st.roles[s];
      });

      this.fx('day');
      this.sysChat('☀️ 天亮了。' + (st.nightDeaths.length
        ? '昨夜 ' + st.nightDeaths.map(s => this.nameOf(s) + '（' + (s + 1) + ' 号，' + this.roleName(st.roles[s]) + '）').join('、') + ' 出局'
        : '昨夜是平安夜，无人出局'));
      st.nightDeaths.forEach(s => this.fx('out'));

      if (this.checkGameEnd()) return;

      const from = st.nightDeaths.length ? st.nightDeaths[0] : st.talkCursor;
      st.phase = 'day-talk';
      st.spoken = new Array(this.n).fill(false);
      st.speakTurn = this.nextAlive(from);
      st.msg = '第 ' + st.day + ' 天 · 从 ' + this.nameOf(st.speakTurn) + ' 开始轮流发言';
      this.pushRender();
    }

    checkGameEnd() {
      const st = this.st;
      if (this.aliveWolves().length === 0) {
        this.gameOver('good', '所有狼人被消灭，好人阵营获胜！');
        return true;
      }
      if (this.aliveWolves().length >= this.aliveGood().length) {
        this.gameOver('wolf', '狼人人数追平好人，狼人阵营获胜！');
        return true;
      }
      return false;
    }

    /* ==================== 白天 ==================== */
    doDone(seat) {
      const st = this.st;
      if (st.over || st.phase !== 'day-talk' || !st.alive[seat] || st.speakTurn !== seat) return;
      st.spoken[seat] = true;
      const rest = this.aliveList().filter(s => !st.spoken[s]);
      if (!rest.length) { this.startDayVote(); return; }
      st.speakTurn = this.nextAlive(st.speakTurn);
      st.talkCursor = st.speakTurn;
      st.msg = '等待 ' + this.nameOf(st.speakTurn) + ' 发言';
      this.fx('act');
      this.pushRender();
    }

    startDayVote() {
      const st = this.st;
      st.phase = 'day-vote';
      st.votes = {};
      st.lastVotes = null;
      st.msg = '发言结束，请所有存活玩家投票放逐（不能投自己），全员投完后开票';
      this.sysChat('第 ' + st.day + ' 天发言结束，进入投票放逐环节');
      this.fx('act');
      this.pushRender();
    }

    doVote(seat, tgt) {
      const st = this.st;
      if (st.over || st.phase !== 'day-vote' || !st.alive[seat]) return;
      if (tgt === seat || !st.alive[tgt]) return;
      st.votes[seat] = tgt;
      this.fx('act');
      const alive = this.aliveList();
      const voted = alive.filter(s => st.votes[s] !== undefined);
      if (voted.length < alive.length) {
        st.msg = '投票中（' + voted.length + '/' + alive.length + ' 已投）';
        this.pushRender();
        return;
      }
      this.tally();
    }

    tally() {
      const st = this.st;
      const count = {};
      this.aliveList().forEach(s => { count[s] = 0; });
      Object.keys(st.votes).forEach(v => { count[st.votes[v]]++; });

      let max = 0, top = [];
      Object.keys(count).forEach(s => {
        if (count[s] > max) { max = count[s]; top = [Number(s)]; }
        else if (count[s] === max) top.push(Number(s));
      });
      st.lastVotes = Object.assign({}, st.votes);

      const tallyText = this.aliveList()
        .filter(s => count[s] > 0)
        .map(s => this.nameOf(s) + ' ' + count[s] + ' 票').join('，');

      if (top.length > 1) {
        st.msg = '平票（' + tallyText + '），无人被放逐，夜幕即将降临';
        this.sysChat('开票：' + tallyText + '。平票，无人被放逐');
        this.nextNight();
        return;
      }

      const out = top[0];
      st.alive[out] = false;
      st.reveal[out] = st.roles[out];
      this.fx('out');
      this.sysChat('开票：' + tallyText + '。' + this.nameOf(out) + '（' + (out + 1) + ' 号）被放逐出局，身份是「' + this.roleName(st.roles[out]) + '」');

      if (this.checkGameEnd()) return;
      st.msg = this.nameOf(out) + ' 被放逐（' + this.roleName(st.roles[out]) + '）';
      this.nextNight();
    }

    nextNight() {
      this.st.day++;
      this.startNight();
    }

    gameOver(winner, text) {
      const st = this.st;
      st.over = true;
      st.winner = winner;
      for (let i = 0; i < this.n; i++) st.reveal[i] = st.roles[i];
      st.msg = text + ' 全部身份已翻开';
      this.sysChat('🏁 ' + text);
      this.pushRender();
    }

    /* 断线玩家视为出局 */
    handleLeave(seat) {
      const st = this.st;
      if (this.dead || seat == null || seat <= 0 || seat >= this.n || !st || st.over || !st.alive[seat]) return;
      st.alive[seat] = false;
      st.reveal[seat] = st.roles[seat];
      this.sysChat(this.nameOf(seat) + ' 断线离开，视为出局（' + this.roleName(st.roles[seat]) + '）');
      delete st.votes[seat];
      delete st.wolfVotes[seat];

      if (this.checkGameEnd()) return;

      if (st.phase === 'night-wolf') {
        const wolves = this.aliveWolves();
        const done = wolves.filter(s => st.wolfVotes[s] !== undefined);
        if (!wolves.length || (wolves.length && done.length >= wolves.length)) {
          st.killTarget = wolves.length ? st.wolfVotes[wolves[0]] : -1;
          this.toCheck();
          return;
        }
        st.msg = '狼人行动中（' + done.length + '/' + wolves.length + ' 已确认）';
      } else if (st.phase === 'night-check' && !this.aliveOf('seer').length) {
        this.toWitch(); return;
      } else if (st.phase === 'night-witch' && !this.aliveOf('witch').length) {
        this.dawn(); return;
      } else if (st.phase === 'day-talk') {
        const rest = this.aliveList().filter(s => !st.spoken[s]);
        if (!rest.length) { this.startDayVote(); return; }
        if (st.speakTurn === seat) {
          st.speakTurn = this.nextAlive(seat);
          st.talkCursor = st.speakTurn;
        }
        st.msg = '等待 ' + this.nameOf(st.speakTurn) + ' 发言';
      } else if (st.phase === 'day-vote') {
        const alive = this.aliveList();
        const voted = alive.filter(s => st.votes[s] !== undefined);
        if (voted.length >= alive.length) { this.tally(); return; }
        st.msg = '投票中（' + voted.length + '/' + alive.length + ' 已投）';
      }
      this.pushRender();
    }

    /* ==================== 联机：房主 ==================== */
    bindHost() {
      const room = this.room;
      this._unsub.push(room.on('data', (msg, seat) => {
        if (this.dead || !msg) return;
        if (seat == null) seat = 1;
        if (seat <= 0 || seat >= this.n) return;
        switch (msg.t) {
          case 'chat': this.guestChat(seat, String(msg.x || '').slice(0, 200)); break;
          case 'wolf': this.doWolf(seat, msg.tgt | 0); break;
          case 'check': this.doCheck(seat, msg.tgt | 0); break;
          case 'witch': this.doWitch(seat, !!msg.save, msg.poison == null ? -1 : (msg.poison | 0)); break;
          case 'done': this.doDone(seat); break;
          case 'vote': this.doVote(seat, msg.tgt | 0); break;
          case 'again':
            if (this.st.over) this.newGame();
            break;
        }
      }));
      this._unsub.push(room.on('leave', seat => this.handleLeave(seat)));
    }

    /* 聊天：白天全员可聊；夜晚仅存活狼人（狼频道密聊） */
    guestChat(seat, x) {
      if (!this.st || !x) return;
      const wolfChannel = this.isNight();
      if (wolfChannel) {
        if (this.st.roles[seat] !== 'wolf' || !this.st.alive[seat]) return;
        this.routeWolfChat(seat, x);
      } else {
        this.broadcastChat(seat, false, x);
      }
    }

    routeWolfChat(from, x) {
      const msg = { t: 'chat', from: from, name: this.players[from].name, x: x, wolf: true };
      this.aliveWolves().forEach(s => {
        if (s !== 0) this.room.sendTo(s, msg);
      });
      if (this.mySeat === 0 && this.st.roles[0] === 'wolf' && this.st.alive[0]) {
        this.appendChat(msg);
        this.render();
      }
    }

    broadcastChat(from, sys, x) {
      const name = from < 0 ? '系统' : this.players[from] ? this.players[from].name : '玩家';
      const msg = { t: 'chat', from: from, name: name, x: x, sys: !!sys };
      this.room.send(msg);
      this.appendChat(msg);
      this.render();
    }
    sysChat(x) { this.broadcastChat(-1, true, x); }

    /* ==================== 联机：客户端 ==================== */
    bindGuest() {
      this.view = null;
      this._unsub.push(this.room.on('data', msg => {
        if (this.dead || !msg) return;
        if (msg.t === 's') {
          this.view = msg.view;
          if (this.view.fx && this.view.fx.seq > this.lastFxSeq) {
            this.lastFxSeq = this.view.fx.seq;
            if (this.view.fx.kind && !this.view.over) Snd.play(this.view.fx.kind);
          }
          this.render();
        } else if (msg.t === 'chat') {
          this.appendChat(msg);
          this.render();
        }
      }));
    }

    appendChat(msg) {
      this.chat.push({
        from: msg.from, name: msg.name || '', x: String(msg.x || '').slice(0, 300),
        sys: !!msg.sys, wolf: !!msg.wolf
      });
      if (this.chat.length > 240) this.chat.splice(0, this.chat.length - 240);
    }

    renderWaiting() {
      this.mount.innerHTML =
        '<p class="text-center text-xs text-slate-500 py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>正在同步对局数据…</p>';
    }

    /* ==================== 客户端动作 ==================== */
    canChatNow() {
      const v = this.currentView();
      if (!v || v.over) return true;
      if (this.isNightPhase(v.phase)) {
        return v.myRole === 'wolf' && v.alive[v.seat];
      }
      return true;
    }
    isNightPhase(p) { return p === 'night-wolf' || p === 'night-check' || p === 'night-witch'; }

    sendChat() {
      if (!this.canChatNow()) { this.toast('夜晚请保持安静（闭眼阶段无法发言）'); return; }
      const input = this.mount.querySelector('.lr-input');
      const x = (input && input.value || '').trim().slice(0, 200);
      if (!x) return;
      if (input) input.value = '';
      if (this.netRole === 'guest') this.room.send({ t: 'chat', x: x });
      else this.guestChat(this.mySeat, x);
    }

    actWolf(tgt) {
      if (this.netRole === 'guest') this.room.send({ t: 'wolf', tgt: tgt });
      else this.doWolf(this.mySeat, tgt);
    }
    actCheck(tgt) {
      if (this.netRole === 'guest') this.room.send({ t: 'check', tgt: tgt });
      else this.doCheck(this.mySeat, tgt);
    }
    actWitchConfirm() {
      const save = this.selSave, poison = this.selPoison;
      this.selSave = false; this.selPoison = -1;
      if (this.netRole === 'guest') this.room.send({ t: 'witch', save: save, poison: poison });
      else this.doWitch(this.mySeat, save, poison);
    }
    actDone() {
      if (this.netRole === 'guest') this.room.send({ t: 'done' });
      else this.doDone(this.mySeat);
    }
    actVote(tgt) {
      if (this.netRole === 'guest') this.room.send({ t: 'vote', tgt: tgt });
      else this.doVote(this.mySeat, tgt);
    }
    actAgain() {
      if (this.netRole === 'guest') {
        this.room.send({ t: 'again' });
        this.toast('已请求再来一局，等待房主确认');
      } else this.newGame();
    }

    /* ==================== 视图 ==================== */
    currentView() {
      if (this.netRole === 'guest') return this.view;
      return this.makeView(this.mySeat);
    }

    makeView(seat) {
      const st = this.st;
      const alive = this.aliveList();
      const voted = alive.filter(s => st.votes[s] !== undefined).length;
      const myRole = st.roles[seat];
      const showAll = st.over;
      const isWolf = myRole === 'wolf';
      const wolves = this.aliveWolves();

      const view = {
        seat: seat, n: this.n,
        names: this.players.map((p, i) => i === seat ? '你' : p.name),
        alive: st.alive.slice(),
        spoken: st.spoken.slice(),
        myRole: myRole,
        roleOf: showAll ? st.roles.slice() : null,
        reveal: Object.assign({}, st.reveal),
        phase: st.phase, day: st.day,
        speakTurn: st.phase === 'day-talk' ? st.speakTurn : -1,
        myVote: st.votes[seat],
        votedCount: voted, aliveCount: alive.length,
        votes: st.lastVotes,
        over: st.over, winner: st.winner,
        msg: st.msg, fx: st.fx,
        // 狼人私有：队友 + 狼队当前目标
        wolfMates: isWolf ? st.roles.map((r, i) => r === 'wolf' ? i : -1).filter(i => i >= 0) : null,
        // 预言家私有：查验记录
        checkLog: myRole === 'seer' ? Object.assign({}, st.checkLog) : null,
        // 女巫私有
        witch: myRole === 'witch' ? {
          saveUsed: st.witchSaveUsed, poisonUsed: st.witchPoisonUsed,
          usedTonight: st.witchUsedTonight,
          seeKill: st.phase === 'night-witch' && !st.witchSaveUsed ? st.killTarget : -1
        } : null,
        night: this.isNightPhasePublic(st.phase)
      };
      // 狼队目标：所有存活狼人看到队伍最新共识（最后提交者的目标）
      if (isWolf && st.phase === 'night-wolf') {
        const submitters = wolves.filter(s => st.wolfVotes[s] !== undefined);
        view.wolfTarget = submitters.length ? st.wolfVotes[submitters[submitters.length - 1]] : -1;
        view.myWolfVote = st.wolfVotes[seat];
      } else {
        view.wolfTarget = -1;
        view.myWolfVote = -1;
      }
      return view;
    }

    isNightPhasePublic(p) { return p === 'night-wolf' || p === 'night-check' || p === 'night-witch'; }

    pushRender() {
      if (this.netRole !== 'host') return;
      for (let s = 1; s < this.n; s++) {
        this.room.sendTo(s, { t: 's', view: this.makeView(s) });
      }
      this.render();
    }

    /* ==================== 渲染 ==================== */
    phaseLabel(v) {
      switch (v.phase) {
        case 'night-wolf': return '🌙 第 ' + v.day + ' 夜 · 狼人行动';
        case 'night-check': return '🌙 第 ' + v.day + ' 夜 · 预言家查验';
        case 'night-witch': return '🌙 第 ' + v.day + ' 夜 · 女巫用药';
        case 'day-talk': return '☀️ 第 ' + v.day + ' 天 · 轮流发言';
        case 'day-vote': return '☀️ 第 ' + v.day + ' 天 · 投票放逐';
        default: return '🏁 对局结束';
      }
    }

    playerCard(v, i) {
      const me = v.seat;
      const dead = !v.alive[i];
      const isTurn = v.phase === 'day-talk' && v.speakTurn === i;
      const isMate = v.wolfMates && v.wolfMates.indexOf(i) >= 0;

      /* 身份标签：终局全公开；死者公开；预言家查验标记；狼队友标记 */
      let roleTag = '';
      if (v.roleOf) {
        const r = v.roleOf[i];
        roleTag = `<span class="lr-tag ${r === 'wolf' ? 'wolfT' : 'goodT'}">${ROLES[r].emoji}${ROLES[r].name}</span>`;
      } else if (dead && v.reveal[i]) {
        const r = v.reveal[i];
        roleTag = `<span class="lr-tag ${r === 'wolf' ? 'wolfT' : 'goodT'}">${ROLES[r].emoji}${ROLES[r].name}</span>`;
      } else if (v.checkLog && v.checkLog[i] !== undefined) {
        roleTag = `<span class="lr-tag ${v.checkLog[i] === 'wolf' ? 'checkw' : 'checkg'}">查验:${v.checkLog[i] === 'wolf' ? '狼' : '好'}</span>`;
      } else if (isMate) {
        roleTag = '<span class="lr-tag wolfT">🐺同伴</span>';
      }

      const speakTag = !dead && v.phase === 'day-talk' && v.spoken[i] && !isTurn ? '<span class="lr-tag donetag">已发言</span>' : '';
      const speakNow = isTurn ? '<span class="lr-tag speak">发言中</span>' : '';

      /* 行动按钮 */
      let actBtn = '';
      const meAlive = v.alive[me];
      if (!v.over && meAlive && !dead) {
        if (v.phase === 'night-wolf' && v.myRole === 'wolf') {
          const isWolfTarget = v.wolfMates && v.wolfMates.indexOf(i) >= 0;
          if (!isWolfTarget) {
            const mine = v.myWolfVote === i;
            actBtn = `<button data-lr="wolf" data-tgt="${i}" class="lr-actbtn kill ${mine ? 'mine' : ''}">${mine ? '✓ 狼队目标' : '🔪 猎杀'}</button>`;
          }
        } else if (v.phase === 'night-check' && v.myRole === 'seer' && i !== me) {
          const res = v.checkLog && v.checkLog[i];
          actBtn = `<button data-lr="check" data-tgt="${i}" class="lr-actbtn ${res ? 'mine' : ''}">${res ? (res === 'wolf' ? '🟥 狼人' : '🟩 好人') : '🔮 查验'}</button>`;
        } else if (v.phase === 'night-witch' && v.myRole === 'witch' && v.witch) {
          if (v.witch.seeKill === i && !v.witch.saveUsed && !v.witch.usedTonight) {
            actBtn = `<button data-lr="toggle-save" class="lr-actbtn ${this.selSave ? 'mine' : ''}">💊 ${this.selSave ? '✓ 将使用解药' : '使用解药救 TA'}</button>`;
          } else if (i !== me && !v.witch.usedTonight && !v.witch.poisonUsed) {
            const mine = this.selPoison === i;
            actBtn = `<button data-lr="toggle-poison" data-tgt="${i}" class="lr-actbtn kill ${mine ? 'mine' : ''}">🧪 ${mine ? '✓ 将使用毒药' : '使用毒药'}</button>`;
          }
        } else if (v.phase === 'day-vote' && i !== me) {
          const mine = v.myVote === i;
          actBtn = `<button data-lr="vote" data-tgt="${i}" class="lr-actbtn ${mine ? 'mine' : ''}">${mine ? '✓ 已投给 TA' : '投 TA 出局'}</button>`;
        }
      }

      return `<div class="lr-pcard ${dead ? 'dead' : ''} ${isTurn ? 'turn' : ''} ${isMate ? 'mate' : ''} ${((this.selPoison === i) || (this.selSave && v.witch && v.witch.seeKill === i)) ? 'pick' : ''}">
        <div class="flex items-center justify-between gap-1">
          <span class="lr-name">${i + 1}号 · ${esc(v.names[i])}${i === me ? '（我）' : ''}</span>
          <span class="flex gap-1 flex-none">${dead ? '<span class="lr-tag deadt">出局</span>' : ''}${roleTag}</span>
        </div>
        <div class="flex items-center gap-1 flex-wrap min-h-[16px]">${speakNow}${speakTag}</div>
        ${actBtn}
      </div>`;
    }

    render() {
      const v = this.currentView();
      if (!v) { this.renderWaiting(); return; }
      const me = v.seat;

      const prevInput = this.mount.querySelector('.lr-input');
      const prevVal = prevInput ? prevInput.value : '';
      const chatHtml = this.chat.map(m => {
        if (m.sys) return `<div class="lr-msg sys">— ${esc(m.x)} —</div>`;
        const mine = m.from === me;
        return `<div class="lr-msg ${m.wolf ? 'wolfc' : ''} ${mine ? 'me' : ''}"><b>${m.wolf ? '🐺' : ''}${esc(m.name)}：</b>${esc(m.x)}</div>`;
      }).join('');

      /* 身份卡 */
      const role = ROLES[v.myRole];
      const roleHtml = this.showRole
        ? `<span class="lr-rolecard ${v.myRole === 'wolf' ? 'wolfc' : ''}" data-lr="togglerole" title="点击隐藏">${role.emoji} 我的身份：${role.name}</span>`
        : `<span class="lr-rolecard" data-lr="togglerole" title="点击查看">我的身份：点击查看 👀</span>`;

      /* 提示行 */
      let hint = '';
      if (!v.over) {
        if (v.phase === 'night-wolf' && v.myRole === 'wolf') {
          hint = v.myWolfVote >= 0
            ? '狼队目标：' + (v.wolfTarget >= 0 ? (v.wolfTarget + 1) + ' 号 · ' + v.names[v.wolfTarget] : '待定') + '（可点击其他目标更改）'
            : '点击下方玩家卡片选择今晚的猎物';
        } else if (v.phase === 'night-witch' && v.myRole === 'witch' && v.witch) {
          const parts = [];
          if (v.witch.seeKill >= 0) parts.push('今晚遇害者：' + (v.witch.seeKill + 1) + ' 号');
          else if (v.witch.saveUsed) parts.push('解药已用完，无法查看遇害者');
          parts.push('解药 ' + (v.witch.saveUsed ? '已用尽' : '可用') + ' · 毒药 ' + (v.witch.poisonUsed ? '已用尽' : '可用') + ' · 每晚限一瓶');
          hint = parts.join('；');
        } else if (v.phase === 'night-wolf') {
          hint = '夜深了，请闭眼等待…（天亮后可发言）';
        }
      }

      const myTurnSpeak = !v.over && v.phase === 'day-talk' && v.speakTurn === me;
      const doneBtn = myTurnSpeak
        ? '<button data-lr="done" class="btn-primary"><i class="fa-solid fa-check mr-1"></i>我说完了，下一位</button>'
        : '';
      const witchConfirm = (!v.over && v.phase === 'night-witch' && v.myRole === 'witch' && v.witch && !v.witch.usedTonight && (this.selSave || this.selPoison >= 0))
        ? '<button data-lr="witch-confirm" class="btn-primary"><i class="fa-solid fa-flask mr-1"></i>确认用药</button>'
        : '';
      const witchSkip = (!v.over && v.phase === 'night-witch' && v.myRole === 'witch' && v.witch && !v.witch.usedTonight)
        ? '<button data-lr="witch-skip" class="btn-ghost"><i class="fa-solid fa-forward-step"></i>今晚不用药</button>'
        : '';

      let voteResult = '';
      if (v.votes) {
        const items = Object.keys(v.votes).map(vs =>
          `<span class="lr-tag">${v.names[vs] || vs} → ${v.names[v.votes[vs]] || v.votes[vs]}</span>`).join('');
        voteResult = `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[10px] text-slate-500">上轮票型：</span>${items}</div>`;
      }

      let overHtml = '';
      if (v.over) {
        const win = (v.winner === 'wolf') === (v.myRole === 'wolf');
        if (!this._overFxDone) {
          this._overFxDone = true;
          Snd.play(win ? 'win' : 'lose');
        }
        overHtml = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(2,6,23,.74);backdrop-filter:blur(4px)">
            <div class="glass-card panel-card w-full max-w-sm p-6 text-center">
              <p class="text-4xl mb-2">${win ? '🎉' : '😢'}</p>
              <p class="text-lg font-bold ${win ? 'text-amber-300' : 'text-slate-200'}">
                ${v.winner === 'wolf' ? '🐺 狼人阵营获胜！' : '✨ 好人阵营获胜！'}</p>
              <p class="text-[12px] text-slate-300 mt-2">你是${role.emoji}${role.name}，属于${v.myRole === 'wolf' ? '狼人' : '好人'}阵营</p>
              <div class="flex gap-2 justify-center mt-5">
                <button data-lr="again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
                <button data-lr="exit" class="btn-ghost"><i class="fa-solid fa-arrow-left-long"></i>返回大厅</button>
              </div>
            </div>
          </div>`;
      }

      const chatPlaceholder = v.over ? '对局已结束，自由聊天'
        : v.night && v.myRole === 'wolf' && v.alive[me] ? '狼频道密聊（仅狼同伴可见）…'
        : v.night ? '夜晚闭眼阶段无法发言' : '输入发言…';

      this.mount.innerHTML = `
        <div class="lr-wrap select-none">
          <div class="glass-card panel-card p-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[12.5px] font-semibold text-cyan-200"><i class="fa-solid fa-moon mr-1"></i>${this.phaseLabel(v)}</span>
                <span class="text-[11px] text-slate-400">${v.aliveCount} 人存活</span>
              </div>
              ${roleHtml}
            </div>
            <p class="text-[11.5px] text-cyan-100/90 mt-2 min-h-[1rem]"><i class="fa-solid fa-circle-info text-cyan-300/60 mr-1"></i>${esc(v.msg || '')}</p>
            ${hint ? '<p class="text-[11px] text-amber-200/80 mt-1"><i class="fa-solid fa-lightbulb text-amber-300/60 mr-1"></i>' + esc(hint) + '</p>' : ''}
            ${voteResult}
            ${(doneBtn || witchConfirm || witchSkip) ? '<div class="mt-2 flex justify-center gap-2 flex-wrap">' + doneBtn + witchConfirm + witchSkip + '</div>' : ''}
          </div>

          <div class="lr-cols">
            <div class="lr-side min-w-0">
              <div class="lr-grid">${v.names.map((_, i) => this.playerCard(v, i)).join('')}</div>
            </div>
            <div class="lr-chatpanel glass-card panel-card p-3">
              <p class="text-[11px] text-slate-400 mb-1.5"><i class="fa-solid fa-comments text-cyan-300/70 mr-1"></i>房间聊天<span class="text-slate-500">（夜晚自动切换为狼人密聊）</span></p>
              <div class="lr-chatlog" id="lr-chatlog">${chatHtml || '<div class="lr-msg sys">聊天室已就绪</div>'}</div>
              <div class="lr-inputrow">
                <input class="lr-input" maxlength="200" placeholder="${chatPlaceholder}" />
                <button data-lr="chat" class="btn-primary lr-send"><i class="fa-solid fa-paper-plane"></i></button>
              </div>
            </div>
          </div>

          <div class="flex justify-center">
            <button data-lr="exit" class="btn-ghost"><i class="fa-solid fa-arrow-left-long"></i>退出对局</button>
          </div>
        </div>
        ${overHtml}`;

      const input = this.mount.querySelector('.lr-input');
      if (input) {
        input.value = prevVal;
        if (this._wasInputFocus) input.focus();
      }
      const log = document.getElementById('lr-chatlog');
      if (log) log.scrollTop = log.scrollHeight;
    }

    handleClick(e) {
      const el = e.target.closest('[data-lr]');
      if (!el) return;
      const act = el.dataset.lr;
      const v = this.currentView();
      if (!v) return;
      switch (act) {
        case 'chat': this._wasInputFocus = true; this.sendChat(); break;
        case 'togglerole': this.showRole = !this.showRole; this.render(); break;
        case 'wolf': if (!v.over) this.actWolf(Number(el.dataset.tgt)); break;
        case 'check': if (!v.over) this.actCheck(Number(el.dataset.tgt)); break;
        case 'toggle-save':
          this.selSave = !this.selSave;
          if (this.selSave) this.selPoison = -1;
          this.render();
          break;
        case 'toggle-poison': {
          const t = Number(el.dataset.tgt);
          this.selPoison = this.selPoison === t ? -1 : t;
          if (this.selPoison >= 0) this.selSave = false;
          this.render();
          break;
        }
        case 'witch-confirm': this.actWitchConfirm(); break;
        case 'witch-skip': {
          this.selSave = false; this.selPoison = -1;
          if (this.netRole === 'guest') this.room.send({ t: 'witch', save: false, poison: -1 });
          else this.doWitch(this.mySeat, false, -1);
          break;
        }
        case 'done': this.actDone(); break;
        case 'vote': this.actVote(Number(el.dataset.tgt)); break;
        case 'again': this.actAgain(); break;
        case 'exit': {
          const btn = document.getElementById('game-leave');
          if (btn) btn.click();
          break;
        }
      }
    }
  }

  /* ---------------- 模块出口（与其他游戏同构） ---------------- */
  window.GG = window.GG || {};
  window.GG.langren = {
    _inst: null,
    start(mount, opts) {
      this.stop();
      this._inst = new Langren(mount, opts);
    },
    stop() {
      if (this._inst) { this._inst.destroy(); this._inst = null; }
    }
  };
})();
