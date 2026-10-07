/* ==================================================================
 * 谁是卧底（4-10 人 · 仅 WebRTC 联机 · 无 AI）
 *  卧底数量：4-7 人 1 名；8-10 人 2 名
 *  流程：系统发词 → 轮流打字描述 → 全员投票 → 出局/平票 → 结算
 *  信令（房主权威）：
 *    客→主  {t:'chat',x} {t:'done'} {t:'vote',tgt} {t:'again'}
 *    主→客  {t:'s',view}  {t:'chat',from,name,x,sys}
 * ================================================================== */
(function () {
  'use strict';

  /* ---------------- 词库（平民词 / 卧底词） ---------------- */
  const WORD_PAIRS = [
    ['可乐', '雪碧'], ['包子', '馒头'], ['奶茶', '咖啡'], ['火锅', '麻辣烫'],
    ['饺子', '馄饨'], ['汉堡', '肉夹馍'], ['苹果', '梨'], ['西瓜', '哈密瓜'],
    ['牛奶', '豆浆'], ['啤酒', '白酒'], ['口红', '唇膏'], ['牙刷', '牙膏'],
    ['毛巾', '浴巾'], ['袜子', '手套'], ['衬衫', 'T恤'], ['眼镜', '墨镜'],
    ['手表', '手环'], ['手机', '平板'], ['电视', '显示器'], ['空调', '风扇'],
    ['冰箱', '冰柜'], ['自行车', '电动车'], ['公交车', '地铁'], ['飞机', '高铁'],
    ['医生', '护士'], ['老师', '教授'], ['警察', '保安'], ['厨师', '面包师'],
    ['演员', '歌手'], ['作家', '编剧'], ['篮球', '排球'], ['足球', '橄榄球'],
    ['乒乓球', '羽毛球'], ['游泳', '跳水'], ['演唱会', '音乐会'], ['电影', '电视剧'],
    ['小说', '散文'], ['春节', '中秋节'], ['蜘蛛', '蝎子'], ['老虎', '狮子'],
    ['鲸鱼', '鲨鱼'], ['鸽子', '麻雀'], ['蝴蝶', '蜻蜓'], ['玫瑰', '月季'],
    ['太阳', '月亮'], ['高山', '大海'], ['沙漠', '草原'], ['钢琴', '吉他'],
    ['相声', '小品'], ['蜡烛', '油灯'], ['雨伞', '雨衣'], ['楼梯', '电梯']
  ];

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
        case 'turn': this.tone(620, .08, 'triangle', .14, 0); break;
        case 'vote': this.tone(430, .09, 'sine', .13, 0); break;
        case 'out':  this.tone(300, .14, 'sawtooth', .1, 0); this.tone(210, .2, 'sawtooth', .1, .12); break;
        case 'win':  [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .15, 'triangle', .18, i * .11)); break;
        case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, .17, 'sine', .15, i * .13)); break;
      }
    }
  };
  document.addEventListener('pointerdown', () => Snd.ensure(), { passive: true });

  /* ---------------- 样式（注入一次） ---------------- */
  const CSS = `
    .uc-wrap{display:flex;flex-direction:column;gap:.6rem}
    .uc-cols{display:flex;flex-direction:column;gap:.6rem;min-width:0}
    .uc-chatpanel{display:flex;flex-direction:column;min-width:0}
    .uc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem}
    @media(min-width:540px){.uc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    .uc-pcard{border-radius:.8rem;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);
      padding:.55rem .6rem;display:flex;flex-direction:column;gap:.3rem;transition:all .2s ease;min-width:0}
    .uc-pcard.turn{border-color:rgba(103,232,249,.6);background:rgba(103,232,249,.1);box-shadow:0 0 12px rgba(103,232,249,.15)}
    .uc-pcard.dead{opacity:.55;filter:saturate(.5)}
    .uc-pcard.voted{border-color:rgba(251,191,36,.55);background:rgba(251,191,36,.08)}
    .uc-name{font-size:11.5px;color:#e2e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .uc-tag{font-size:9.5px;padding:1px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.16);color:#cbd5e1;white-space:nowrap}
    .uc-tag.speak{background:rgba(103,232,249,.16);border-color:rgba(103,232,249,.5);color:#a5f3fc}
    .uc-tag.donetag{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.45);color:#6ee7b7}
    .uc-tag.deadt{background:rgba(244,63,94,.14);border-color:rgba(244,63,94,.4);color:#fda4af}
    .uc-tag.rolet{background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.45);color:#fcd34d}
    .uc-tag.undt{background:rgba(217,70,239,.16);border-color:rgba(217,70,239,.5);color:#f0abfc}
    .uc-votebtn{font-size:10.5px;padding:3px 0;border-radius:.55rem;background:rgba(103,232,249,.1);
      border:1px solid rgba(103,232,249,.35);color:#a5f3fc;cursor:pointer;transition:all .15s ease;width:100%}
    .uc-votebtn:hover{background:rgba(103,232,249,.22)}
    .uc-votebtn.mine{background:rgba(251,191,36,.2);border-color:rgba(251,191,36,.6);color:#fde68a}
    .uc-word{display:inline-flex;align-items:center;gap:.45rem;padding:.4rem .9rem;border-radius:.9rem;
      background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.4);color:#fde68a;font-weight:700;font-size:14px;cursor:pointer}
    .uc-chatlog{height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:.3rem;padding-right:2px;
      border:1px solid rgba(255,255,255,.08);border-radius:.8rem;background:rgba(2,6,23,.4);padding:8px}
    .uc-chatlog::-webkit-scrollbar{width:5px}
    .uc-chatlog::-webkit-scrollbar-thumb{background:rgba(103,232,249,.25);border-radius:3px}
    .uc-msg{font-size:11.5px;line-height:1.55;word-break:break-word;color:#e2e8f0}
    .uc-msg b{color:#67e8f9;font-weight:600;margin-right:.3rem}
    .uc-msg.sys{text-align:center;color:#94a3b8;font-size:10.5px}
    .uc-me b{color:#fcd34d}
    .uc-inputrow{display:flex;gap:.45rem;margin-top:.45rem}
    .uc-input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(148,197,255,.16);
      color:#e2e8f0;border-radius:.7rem;padding:.5rem .7rem;font-size:12.5px}
    .uc-input:focus{outline:none;border-color:rgba(103,232,249,.5)}
    .uc-send{flex:none}
    @media(min-width:780px){
      .uc-cols{flex-direction:row;align-items:stretch}
      .uc-side{flex:1;min-width:0}
      .uc-chatpanel{width:340px;flex:none}
      .uc-chatlog{flex:1;height:auto;min-height:230px}
    }
    body.orient-land #game-mount .uc-cols{flex-direction:row;align-items:stretch}
    body.orient-land #game-mount .uc-chatpanel{width:290px;flex:none}
    body.orient-land #game-mount .uc-chatlog{height:auto;max-height:calc(100vh - 220px);max-height:calc(100dvh - 220px)}
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
   * 主类（房主权威；客端只渲染 view + 追加聊天）
   * ================================================================== */
  class Undercover {
    constructor(mount, opts) {
      this.mount = mount;
      this.toast = opts.toast || function () {};
      this.isNet = opts.mode === 'net';
      this.mySeat = opts.seat || 0;
      this.room = opts.room || null;
      this.dead = false;
      this.timers = [];
      this._unsub = [];
      this.chat = [];              // 本地聊天记录（双方各自累积）
      this.lastFxSeq = 0;
      this._overFxDone = false;
      this.showWord = false;       // 词语遮挡（防偷窥）
      this._wasInputFocus = false;

      if (!document.getElementById('uc-style')) {
        const st = document.createElement('style');
        st.id = 'uc-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      }

      if (!this.isNet) {
        this.mount.innerHTML =
          '<p class="text-center text-xs text-amber-200 py-10 glass-card p-6">谁是卧底为纯联机派对游戏（无 AI）。<br>请在大厅选择「联机对战」，创建房间邀请 3 位以上好友加入。</p>';
        return;
      }

      this.n = Math.max(4, Math.min(10, opts.count || 4));
      this.netRole = this.mySeat === 0 ? 'host' : 'guest';
      this.players = [];
      for (let i = 0; i < this.n; i++) this.players.push({ name: i === 0 ? '房主' : '玩家 ' + (i + 1) });

      this._onClick = e => this.handleClick(e);
      this._onKey = e => {
        if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('uc-input')) {
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

    delay(fn, ms) {
      const t = setTimeout(() => { if (!this.dead) fn(); }, ms);
      this.timers.push(t);
      return t;
    }

    nameOf(s) {
      if (s === this.mySeat) return '你';
      return this.players[s] ? this.players[s].name : '玩家 ' + (s + 1);
    }

    fx(kind) {
      this.st.fx = { seq: this.st.fx.seq + 1, kind: kind };
      if (this.netRole !== 'guest') Snd.play(kind);
    }

    /* ==================== 开局（仅房主调用） ==================== */
    newGame() {
      const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
      const undCount = this.n >= 8 ? 2 : 1;
      const roles = new Array(this.n).fill('civ');
      const idx = shuffle(Array.from({ length: this.n }, (_, i) => i));
      for (let k = 0; k < undCount; k++) roles[idx[k]] = 'und';

      this.st = {
        words: { civ: pair[0], und: pair[1] },
        roles: roles,
        alive: new Array(this.n).fill(true),
        phase: 'talk',           // talk | vote | over
        round: 1,
        speakTurn: Math.floor(Math.random() * this.n),
        spoken: new Array(this.n).fill(false),
        votes: {},               // voterSeat -> targetSeat（本轮）
        lastVotes: null,         // 上轮票型（公开）
        over: false, winner: '', // 'civ' | 'und'
        reveal: {},              // seat -> 'civ'|'und'（出局或终局公开）
        msg: '', fx: { seq: 0, kind: '' }
      };
      this._overFxDone = false;
      this.st.spoken[this.st.speakTurn] = false;
      this.st.msg = '第 1 轮描述开始，从 ' + this.nameOf(this.st.speakTurn) + ' 开始，每人用一句话描述自己的词';
      this.sysChat('游戏开始！共 ' + this.n + ' 人，其中 ' + undCount + ' 名卧底。' + this.st.msg);
      this.pushRender();
    }

    aliveList() {
      const out = [];
      for (let i = 0; i < this.n; i++) if (this.st.alive[i]) out.push(i);
      return out;
    }
    aliveUnd() { return this.aliveList().filter(s => this.st.roles[s] === 'und').length; }
    aliveCiv() { return this.aliveList().filter(s => this.st.roles[s] === 'civ').length; }
    nextAlive(from) {
      const n = this.n;
      for (let k = 1; k <= n; k++) {
        const s = (from + k) % n;
        if (this.st.alive[s]) return s;
      }
      return from;
    }
    firstAlive() { return this.aliveList()[0]; }

    /* ==================== 房主：状态机 ==================== */
    doDone(seat) {
      const st = this.st;
      if (st.over || st.phase !== 'talk' || !st.alive[seat] || st.speakTurn !== seat) return;
      st.spoken[seat] = true;
      const rest = this.aliveList().filter(s => !st.spoken[s]);
      if (!rest.length) { this.startVote(); return; }
      st.speakTurn = this.nextAlive(st.speakTurn);
      st.msg = '等待 ' + this.nameOf(st.speakTurn) + ' 描述';
      this.fx('turn');
      this.pushRender();
    }

    startVote() {
      const st = this.st;
      st.phase = 'vote';
      st.votes = {};
      st.lastVotes = null;
      st.msg = '描述结束，请所有存活玩家投票（不能投自己），全员投完后开票';
      this.sysChat('第 ' + st.round + ' 轮描述结束，进入投票环节');
      this.fx('vote');
      this.pushRender();
    }

    doVote(seat, tgt) {
      const st = this.st;
      if (st.over || st.phase !== 'vote' || !st.alive[seat]) return;
      if (tgt === seat || !st.alive[tgt]) return;
      st.votes[seat] = tgt;
      this.fx('vote');
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
        st.msg = '平票（' + tallyText + '），本轮无人出局，进入下一轮';
        this.sysChat('开票：' + tallyText + '。平票，无人出局！');
        this.nextRound(this.firstAlive());
        return;
      }

      const out = top[0];
      st.alive[out] = false;
      st.reveal[out] = st.roles[out];
      const isUnd = st.roles[out] === 'und';
      this.fx('out');
      this.sysChat('开票：' + tallyText + '。' + this.nameOf(out) + '（' + (out + 1) + ' 号）被出局，身份是「' + (isUnd ? '卧底' : '平民') + '」');

      if (this.aliveUnd() === 0) {
        this.gameOver('civ', '所有卧底被找出，平民阵营获胜！');
        return;
      }
      if (this.aliveUnd() >= this.aliveCiv()) {
        this.gameOver('und', '卧底人数追平平民，卧底阵营获胜！');
        return;
      }
      st.msg = this.nameOf(out) + ' 出局（' + (isUnd ? '是卧底！' : '不是卧底…') + '），继续下一轮';
      this.nextRound(out);
    }

    nextRound(fromSeat) {
      const st = this.st;
      st.round++;
      st.phase = 'talk';
      st.spoken = new Array(this.n).fill(false);
      st.votes = {};
      st.speakTurn = this.nextAlive(fromSeat);
      st.msg = '第 ' + st.round + ' 轮描述，从 ' + this.nameOf(st.speakTurn) + ' 开始';
      this.pushRender();
    }

    gameOver(winner, text) {
      const st = this.st;
      st.over = true;
      st.winner = winner;
      for (let i = 0; i < this.n; i++) st.reveal[i] = st.roles[i];
      st.msg = text + ' 平民词是「' + st.words.civ + '」，卧底词是「' + st.words.und + '」';
      this.sysChat('🏁 ' + text);
      this.pushRender();
    }

    /* 断线玩家视为出局 */
    handleLeave(seat) {
      const st = this.st;
      if (this.dead || seat == null || seat <= 0 || seat >= this.n || !st || st.over || !st.alive[seat]) return;
      st.alive[seat] = false;
      st.reveal[seat] = st.roles[seat];
      this.sysChat(this.nameOf(seat) + ' 断线离开，视为出局（' + (st.roles[seat] === 'und' ? '卧底' : '平民') + '）');
      delete st.votes[seat];

      if (this.aliveUnd() === 0) { this.gameOver('civ', '所有卧底被找出，平民阵营获胜！'); return; }
      if (this.aliveUnd() >= this.aliveCiv()) { this.gameOver('und', '卧底人数追平平民，卧底阵营获胜！'); return; }

      if (st.phase === 'talk') {
        const rest = this.aliveList().filter(s => !st.spoken[s]);
        if (!rest.length) { this.startVote(); return; }
        if (st.speakTurn === seat) st.speakTurn = this.nextAlive(seat);
        st.msg = '等待 ' + this.nameOf(st.speakTurn) + ' 描述';
      } else if (st.phase === 'vote') {
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
          case 'chat':
            this.broadcastChat(seat, false, String(msg.x || '').slice(0, 200));
            break;
          case 'done': this.doDone(seat); break;
          case 'vote': this.doVote(seat, msg.tgt | 0); break;
          case 'again':
            if (this.st.over) this.newGame();
            break;
        }
      }));
      this._unsub.push(room.on('leave', seat => this.handleLeave(seat)));
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
      this.chat.push({ from: msg.from, name: msg.name || '', x: String(msg.x || '').slice(0, 300), sys: !!msg.sys });
      if (this.chat.length > 220) this.chat.splice(0, this.chat.length - 220);
    }

    renderWaiting() {
      this.mount.innerHTML =
        '<p class="text-center text-xs text-slate-500 py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>正在同步对局数据…</p>';
    }

    /* ==================== 客户端动作 ==================== */
    actChat() {
      const input = this.mount.querySelector('.uc-input');
      const x = (input && input.value || '').trim().slice(0, 200);
      if (!x) return;
      if (input) input.value = '';
      if (this.netRole === 'guest') this.room.send({ t: 'chat', x: x });
      else this.broadcastChat(this.mySeat, false, x);
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

    /* ==================== 渲染 ==================== */
    currentView() {
      if (this.netRole === 'guest') return this.view;
      return this.makeView(this.mySeat);
    }

    makeView(seat) {
      const st = this.st;
      const alive = this.aliveList();
      const voted = alive.filter(s => st.votes[s] !== undefined).length;
      const showAll = st.over;
      return {
        seat: seat, n: this.n,
        names: this.players.map((p, i) => i === seat ? '你' : p.name),
        alive: st.alive.slice(),
        spoken: st.spoken.slice(),
        word: st.roles[seat] === 'und' ? st.words.und : st.words.civ,
        isUnd: st.roles[seat] === 'und',
        roleOf: showAll ? st.roles.slice() : null,
        words: showAll ? { civ: st.words.civ, und: st.words.und } : null,
        reveal: Object.assign({}, st.reveal),
        phase: st.phase, round: st.round,
        speakTurn: st.phase === 'talk' ? st.speakTurn : -1,
        myVote: st.votes[seat],
        votedCount: voted, aliveCount: alive.length,
        votes: st.lastVotes,
        over: st.over, winner: st.winner,
        msg: st.msg, fx: st.fx
      };
    }

    pushRender() {
      if (this.netRole !== 'host') return;
      for (let s = 1; s < this.n; s++) {
        this.room.sendTo(s, { t: 's', view: this.makeView(s) });
      }
      this.render();
    }

    playerCard(v, i) {
      const me = v.seat;
      const dead = !v.alive[i];
      const isTurn = v.phase === 'talk' && v.speakTurn === i;
      const knownRole = v.roleOf ? v.roleOf[i] : v.reveal[i];
      const roleTxt = dead && knownRole ? (knownRole === 'und' ? '卧底' : '平民') : '';
      const roleTag = roleTxt
        ? `<span class="uc-tag ${knownRole === 'und' ? 'undt' : 'rolet'}">${roleTxt}</span>` : '';
      const speakTag = !dead && v.phase === 'talk' && v.spoken[i] && !isTurn ? '<span class="uc-tag donetag">已描述</span>' : '';
      const speakNow = isTurn ? '<span class="uc-tag speak">描述中</span>' : '';

      let voteBtn = '';
      if (v.phase === 'vote' && v.alive[me] && v.alive[i] && i !== me && !v.over) {
        const mine = v.myVote === i;
        voteBtn = `<button data-uc="vote" data-tgt="${i}" class="uc-votebtn ${mine ? 'mine' : ''}">${mine ? '✓ 已投给 TA' : '投 TA 出局'}</button>`;
      }

      return `<div class="uc-pcard ${dead ? 'dead' : ''} ${isTurn ? 'turn' : ''} ${v.myVote === i && v.phase === 'vote' ? 'voted' : ''}">
        <div class="flex items-center justify-between gap-1">
          <span class="uc-name">${i + 1}号 · ${esc(v.names[i])}${i === me ? '（我）' : ''}</span>
          <span class="flex gap-1 flex-none">${dead ? '<span class="uc-tag deadt">出局</span>' : ''}${roleTag}</span>
        </div>
        <div class="flex items-center gap-1 flex-wrap min-h-[16px]">${speakNow}${speakTag}</div>
        ${voteBtn}
      </div>`;
    }

    render() {
      const v = this.currentView();
      if (!v) { this.renderWaiting(); return; }
      const me = v.seat;

      /* 聊天区（保留输入框内容与焦点） */
      const prevInput = this.mount.querySelector('.uc-input');
      const prevVal = prevInput ? prevInput.value : '';
      const chatHtml = this.chat.map(m => {
        if (m.sys) return `<div class="uc-msg sys">— ${esc(m.x)} —</div>`;
        const mine = m.from === me;
        return `<div class="uc-msg ${mine ? 'uc-me' : ''}"><b>${esc(m.name)}：</b>${esc(m.x)}</div>`;
      }).join('');

      /* 我的词语 */
      const wordHtml = this.showWord
        ? `<span class="uc-word" data-uc="toggleword" title="点击隐藏">我的词语：${esc(v.word)} ${v.isUnd ? '🕶️' : '🙂'}</span>`
        : `<span class="uc-word" data-uc="toggleword" title="点击查看">我的词语：点击查看 👀</span>`;

      /* 顶部状态 */
      const phaseTxt = v.over ? '对局结束'
        : v.phase === 'talk' ? '第 ' + v.round + ' 轮 · 轮流描述'
        : '第 ' + v.round + ' 轮 · 投票';
      const myTurnSpeak = !v.over && v.phase === 'talk' && v.speakTurn === me;
      const doneBtn = myTurnSpeak
        ? '<button data-uc="done" class="btn-primary"><i class="fa-solid fa-check mr-1"></i>我说完了，下一位</button>'
        : '';

      /* 开票结果条 */
      let voteResult = '';
      if (v.votes) {
        const items = Object.keys(v.votes).map(vs =>
          `<span class="uc-tag">${v.names[vs] || vs} → ${v.names[v.votes[vs]] || v.votes[vs]}</span>`).join('');
        voteResult = `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[10px] text-slate-500">上轮票型：</span>${items}</div>`;
      }

      /* 结算弹层 */
      let overHtml = '';
      if (v.over) {
        const win = v.winner === 'civ' ? !v.isUnd : v.isUnd;
        if (!this._overFxDone) {
          this._overFxDone = true;
          Snd.play(win ? 'win' : 'lose');
        }
        overHtml = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(2,6,23,.74);backdrop-filter:blur(4px)">
            <div class="glass-card panel-card w-full max-w-sm p-6 text-center">
              <p class="text-4xl mb-2">${win ? '🎉' : '😢'}</p>
              <p class="text-lg font-bold ${win ? 'text-amber-300' : 'text-slate-200'}">
                ${v.winner === 'civ' ? '平民阵营获胜！' : '卧底阵营获胜！'}</p>
              <p class="text-[12px] text-slate-400 mt-2">${v.words ? '平民词「' + esc(v.words.civ) + '」· 卧底词「' + esc(v.words.und) + '」' : ''}</p>
              <p class="text-[12px] text-slate-300 mt-1">你是${v.isUnd ? '🕵️ 卧底' : '🙂 平民'}</p>
              <div class="flex gap-2 justify-center mt-5">
                <button data-uc="again" class="btn-primary"><i class="fa-solid fa-rotate-right"></i>再来一局</button>
                <button data-uc="exit" class="btn-ghost"><i class="fa-solid fa-arrow-left-long"></i>返回大厅</button>
              </div>
            </div>
          </div>`;
      }

      this.mount.innerHTML = `
        <div class="uc-wrap select-none">
          <div class="glass-card panel-card p-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[12.5px] font-semibold text-cyan-200"><i class="fa-solid fa-user-secret mr-1"></i>${phaseTxt}</span>
                <span class="text-[11px] text-slate-400">${v.aliveCount} 人存活</span>
              </div>
              ${wordHtml}
            </div>
            <p class="text-[11.5px] text-cyan-100/90 mt-2 min-h-[1rem]"><i class="fa-solid fa-circle-info text-cyan-300/60 mr-1"></i>${esc(v.msg || '')}</p>
            ${voteResult}
            ${doneBtn ? '<div class="mt-2 flex justify-center">' + doneBtn + '</div>' : ''}
          </div>

          <div class="uc-cols">
            <div class="uc-side space-y-2 min-w-0">
              <div class="uc-grid">${v.names.map((_, i) => this.playerCard(v, i)).join('')}</div>
            </div>
            <div class="uc-chatpanel glass-card panel-card p-3">
              <p class="text-[11px] text-slate-400 mb-1.5"><i class="fa-solid fa-comments text-cyan-300/70 mr-1"></i>房间聊天（描述你的词、讨论、推理都在这里）</p>
              <div class="uc-chatlog" id="uc-chatlog">${chatHtml || '<div class="uc-msg sys">聊天室已就绪，说点什么吧</div>'}</div>
              <div class="uc-inputrow">
                <input class="uc-input" maxlength="200" placeholder="输入发言…" />
                <button data-uc="chat" class="btn-primary uc-send"><i class="fa-solid fa-paper-plane"></i></button>
              </div>
            </div>
          </div>

          <div class="flex justify-center">
            <button data-uc="exit" class="btn-ghost"><i class="fa-solid fa-arrow-left-long"></i>退出对局</button>
          </div>
        </div>
        ${overHtml}`;

      /* 恢复输入框内容 / 焦点，聊天滚到底 */
      const input = this.mount.querySelector('.uc-input');
      if (input) {
        input.value = prevVal;
        if (this._wasInputFocus) input.focus();
      }
      const log = document.getElementById('uc-chatlog');
      if (log) log.scrollTop = log.scrollHeight;
    }

    handleClick(e) {
      const el = e.target.closest('[data-uc]');
      if (!el) return;
      const act = el.dataset.uc;
      switch (act) {
        case 'chat': this._wasInputFocus = true; this.actChat(); break;
        case 'toggleword': this.showWord = !this.showWord; this.render(); break;
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
  window.GG.undercover = {
    _inst: null,
    start(mount, opts) {
      this.stop();
      this._inst = new Undercover(mount, opts);
    },
    stop() {
      if (this._inst) { this._inst.destroy(); this._inst = null; }
    }
  };
})();
