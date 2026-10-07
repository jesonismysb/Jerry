/* ==================================================================
 * 奈良 · 每日签到 & 游戏积分解锁（纯前端，localStorage）
 *  - 每日签到 +10；连续 ≥7/15/30 天每日额外 +5/+10/+20
 *  - 断签清零连续天数；累计天数与总积分永久保留
 *  - 五子棋 / 中国象棋默认可玩；UNO 需 150 积分解锁，永久保存
 *
 * 页面接入：
 *   index.html ：<button id="nara-checkin-fab"> + 本脚本
 *   tools.html / games.html：给 UNO 入口加 data-uno-lock 属性 + 本脚本
 * ================================================================== */
(function () {
  'use strict';

  var KEY = 'nara_checkin_v1';
  var UNO_COST = 150;

  /* 游戏解锁积分地图（UNO 保持原 150；新增游戏按定价） */
  var GAME_COSTS = {
    uno: 150,
    tiaoqi: 200,      // 跳棋
    doushou: 180,     // 斗兽棋
    heibai: 160,      // 黑白棋
    undercover: 250,  // 谁是卧底
    langren: 300,     // 狼人杀
    turtlet: 200      // 海龟汤
  };

  /* ---------------- 日期工具（本地时区） ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function addDays(d, k) { var x = new Date(d); x.setDate(x.getDate() + k); return x; }
  function isYesterday(last, today) {
    if (!last) return false;
    return last === dateStr(addDays(today, -1));
  }

  /* ---------------- 存档 ---------------- */
  function defaultState() {
    return {
      last: '',                 // 最近签到日 YYYY-MM-DD
      days: {},                 // 签到日 -> 当日获得积分
      streak: 0,                // 连续签到天数
      total: 0,                 // 累计签到总天数
      points: 0,                // 当前总积分
      sound: true,              // 签到音效开关
      unlocks: { uno: false },  // 游戏永久解锁状态
      milestones: { 7: false, 15: false, 30: false } // 里程碑祝贺是否已弹过
    };
  }
  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return defaultState();
    var d = defaultState();
    // 逐字段合并，向前兼容
    Object.keys(d).forEach(function (k) {
      if (s[k] !== undefined) d[k] = s[k];
    });
    if (!d.days || typeof d.days !== 'object') d.days = {};
    if (!d.unlocks) d.unlocks = { uno: false };
    if (!d.milestones) d.milestones = { 7: false, 15: false, 30: false };
    return d;
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  var state = load();

  /* ---------------- 音效（WebAudio 合成，零外部资源） ---------------- */
  var Snd = {
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return this.ctx;
    },
    tone: function (f, dur, type, vol, delay) {
      var ctx = this.ctx;
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    play: function (kind) {
      if (!state.sound || !this.ensure()) return;
      if (kind === 'sign') {
        this.tone(523, .1, 'triangle', .17, 0);
        this.tone(659, .1, 'triangle', .17, .09);
        this.tone(784, .16, 'triangle', .18, .18);
      } else if (kind === 'unlock') {
        this.tone(659, .1, 'sine', .18, 0);
        this.tone(880, .1, 'sine', .18, .1);
        this.tone(1174, .2, 'sine', .2, .2);
      }
    }
  };
  document.addEventListener('pointerdown', function () { Snd.ensure(); }, { passive: true });

  /* ---------------- 签到规则 ---------------- */
  function signedToday() { return state.last === todayStr(); }

  function streakBonus(streak) {
    if (streak >= 30) return 20;
    if (streak >= 15) return 10;
    if (streak >= 7) return 5;
    return 0;
  }

  /* 执行签到；返回 {ok, reason, base, bonus, gained, streak, milestone} */
  function signIn() {
    var today = todayStr();
    if (state.last === today) return { ok: false, reason: '今天已经签过到啦' };

    if (isYesterday(state.last, new Date())) state.streak += 1;
    else state.streak = 1;  // 断签：连续天数从 1 重新累计（累计天数/积分不动）

    var base = 10;
    var bonus = streakBonus(state.streak);
    var gained = base + bonus;

    state.last = today;
    state.total += 1;
    state.points += gained;
    state.days[today] = gained;

    var milestone = 0;
    [30, 15, 7].forEach(function (m) {
      if (!milestone && state.streak === m && !state.milestones[m]) {
        milestone = m;
        state.milestones[m] = true;
      }
    });

    save(state);
    Snd.play('sign');
    return { ok: true, base: base, bonus: bonus, gained: gained, streak: state.streak, milestone: milestone };
  }

  /* ---------------- 游戏解锁（通用；UNO 行为保持不变） ---------------- */
  function isUnlocked(game) {
    if (!GAME_COSTS[game]) return true;        // 免费游戏（五子棋 / 象棋等）
    return !!state.unlocks[game];
  }
  function unlockGame(game) {
    var cost = GAME_COSTS[game];
    if (cost == null) return { ok: true, already: true };
    if (state.unlocks[game]) return { ok: true, already: true };
    if (state.points < cost) return { ok: false, reason: '积分不足，请每日签到赚取积分' };
    state.points -= cost;
    state.unlocks[game] = true;
    save(state);
    Snd.play('unlock');
    return { ok: true };
  }
  function unlockUno() { return unlockGame('uno'); }

  /* ---------------- 样式注入 ---------------- */
  var CSS = [
    '.nc-fab{position:fixed;right:1rem;bottom:calc(1rem + env(safe-area-inset-bottom));z-index:60;',
    'display:inline-flex;align-items:center;gap:.4rem;padding:.55rem .95rem;border-radius:999px;font-size:12.5px;font-weight:600;',
    'color:#ecfeff;background:linear-gradient(to right,rgba(8,145,178,.9),rgba(14,165,233,.9));',
    'border:1px solid rgba(103,232,249,.5);box-shadow:0 8px 24px rgba(8,145,178,.35);cursor:pointer;',
    'transition:transform .25s ease,box-shadow .25s ease;white-space:nowrap}',
    '.nc-fab:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(103,232,249,.4)}',
    '.nc-fab:active{transform:scale(.96)}',
    '.nc-fab.done{background:rgba(15,23,42,.82);border-color:rgba(94,234,212,.45);color:#99f6e4}',
    '@media(min-width:640px){.nc-fab{right:1.5rem;bottom:calc(1.5rem + env(safe-area-inset-bottom));font-size:13px}}',
    '.nc-mask{position:fixed;inset:0;z-index:80;background:rgba(2,6,23,.66);backdrop-filter:blur(4px);',
    'display:none;align-items:center;justify-content:center;padding:1rem}',
    '.nc-mask.show{display:flex}',
    '.nc-box{width:100%;max-width:420px;max-height:88vh;overflow-y:auto;background:rgba(15,23,42,.97);',
    'border:1px solid rgba(103,232,249,.25);border-radius:1.1rem;box-shadow:0 20px 60px rgba(2,8,23,.6)}',
    '.nc-box::-webkit-scrollbar{width:6px}.nc-box::-webkit-scrollbar-thumb{background:rgba(103,232,249,.3);border-radius:3px}',
    '.nc-stat{flex:1;text-align:center;padding:.6rem .3rem;border-radius:.8rem;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08)}',
    '.nc-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}',
    '.nc-cal .dow{text-align:center;font-size:10.5px;color:#64748b;padding:3px 0}',
    '.nc-dcell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'font-size:11.5px;border-radius:.45rem;color:#cbd5e1;background:transparent}',
    '.nc-dcell.signed{background:rgba(103,232,249,.16);color:#a5f3fc;font-weight:700}',
    '.nc-dcell.today{outline:1.5px solid rgba(103,232,249,.75)}',
    '.nc-dcell.future{color:#475569}',
    '.nc-dcell .plus{font-size:8.5px;line-height:1;color:#67e8f9}',
    '.nc-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.55rem 1.1rem;border-radius:999px;',
    'font-size:13px;font-weight:600;color:#ecfeff;background:linear-gradient(to right,rgba(8,145,178,.85),rgba(14,165,233,.85));',
    'border:1px solid rgba(103,232,249,.4);box-shadow:0 6px 20px rgba(8,145,178,.25);cursor:pointer;transition:all .2s ease}',
    '.nc-btn:active{transform:scale(.97)}',
    '.nc-ghost{display:inline-flex;align-items:center;gap:.35rem;font-size:12px;color:#cbd5e1;padding:.4rem .8rem;border-radius:999px;',
    'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:all .2s ease}',
    '.nc-ghost:hover{color:#67e8f9;border-color:rgba(103,232,249,.4)}',
    '.nc-lockbadge{position:absolute;top:4px;right:4px;font-size:11px;z-index:2;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}',
    '.nc-locked{filter:saturate(.7) brightness(.82)}',
    '#nc-toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(20px);',
    'opacity:0;pointer-events:none;background:rgba(8,145,178,.94);color:#ecfeff;font-size:13.5px;padding:9px 18px;border-radius:999px;',
    'box-shadow:0 8px 24px rgba(8,145,178,.35);transition:opacity .3s,transform .3s;z-index:95;max-width:88vw;text-align:center}',
    '#nc-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
    '@keyframes ncPop{0%{opacity:0;transform:scale(.85) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}',
    '.nc-pop{animation:ncPop .35s cubic-bezier(.2,.9,.3,1.2) both}'
  ].join('');

  function injectCss() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------------- Toast（复用页面已有 #toast，否则自建） ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    var selfMade = false;
    if (!el) {
      el = document.createElement('div');
      el.id = 'nc-toast';
      document.body.appendChild(el);
      selfMade = true;
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ---------------- 弹层容器 ---------------- */
  var masks = {};
  function ensureMask(id) {
    if (masks[id]) return masks[id];
    var m = document.createElement('div');
    m.className = 'nc-mask';
    m.id = id;
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
    document.body.appendChild(m);
    masks[id] = m;
    return m;
  }
  function closeMasks() { Object.keys(masks).forEach(function (k) { masks[k].classList.remove('show'); }); }

  var MILESTONE_TEXT = {
    7: { icon: '🎉', title: '连续签到 7 天！', lines: ['坚持满一周，渐入佳境～', '从今天起每日签到额外 +5 积分'] },
    15: { icon: '🔥', title: '连续签到 15 天！', lines: ['半月不辍，为你点赞！', '每日签到额外加成提升到 +10 积分'] },
    30: { icon: '🏆', title: '连续签到 30 天！', lines: ['一整月的坚持，毅力可嘉！', '每日签到额外加成提升到 +20 积分，继续冲鸭'] }
  };

  function showMilestone(m) {
    var info = MILESTONE_TEXT[m];
    if (!info) return;
    var mask = ensureMask('nc-mask-mile');
    mask.innerHTML =
      '<div class="nc-box nc-pop p-6 text-center" style="max-width:340px">' +
      '<p style="font-size:46px;line-height:1">' + info.icon + '</p>' +
      '<p class="text-lg font-bold text-amber-300 mt-2">' + info.title + '</p>' +
      info.lines.map(function (l) { return '<p class="text-[13px] text-slate-300 mt-2 leading-relaxed">' + l + '</p>'; }).join('') +
      '<button class="nc-btn mt-5" data-nc="mile-ok">收下鼓励，继续加油</button>' +
      '</div>';
    mask.classList.add('show');
  }

  /* ---------------- 签到弹窗（日历视图） ---------------- */
  var calCursor = null; // 日历当前显示月（Date，取年月）

  function monthMatrix(year, month) {
    var first = new Date(year, month, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < startDow; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }

  /* 显示用连续天数：最近签到既不是今天也不是昨天 → 已断签，展示 0 */
  function effectiveStreak() {
    if (!state.last) return 0;
    if (state.last === todayStr()) return state.streak;
    if (isYesterday(state.last, new Date())) return state.streak;
    return 0;
  }

  function renderSignModal() {
    var mask = ensureMask('nc-mask-sign');
    var now = new Date();
    if (!calCursor) calCursor = new Date(now.getFullYear(), now.getMonth(), 1);

    var y = calCursor.getFullYear(), m = calCursor.getMonth();
    var isCurMonth = y === now.getFullYear() && m === now.getMonth();
    var cells = monthMatrix(y, m);
    var todayK = todayStr();
    var cellsHtml = cells.map(function (d) {
      if (d === null) return '<span></span>';
      var key = y + '-' + pad(m + 1) + '-' + pad(d);
      var cls = 'nc-dcell';
      var inner = String(d);
      var gained = state.days[key];
      if (gained) {
        cls += ' signed';
        inner += '<span class="plus">+' + gained + '</span>';
      }
      if (key === todayK) cls += ' today';
      var cellDate = new Date(y, m, d);
      if (cellDate > now && !gained) cls += ' future';
      return '<span class="' + cls + '">' + inner + '</span>';
    }).join('');

    var done = signedToday();
    var eff = effectiveStreak();
    var nextMile = eff < 7 ? 7 : eff < 15 ? 15 : eff < 30 ? 30 : 0;
    var progress = nextMile
      ? '<p class="text-[11px] text-slate-500 mt-2"><i class="fa-solid fa-flag text-cyan-300/60 mr-1"></i>' +
        '距连续 ' + nextMile + ' 天里程碑还差 ' + (nextMile - eff) + ' 天</p>'
      : '<p class="text-[11px] text-amber-300/80 mt-2"><i class="fa-solid fa-crown mr-1"></i>已达成全部里程碑，保持住！</p>';

    // 本次签到将落到的连续天数：昨天有签→接续，否则（含断签/首次）从 1 开始
    var afterSignStreak = (!done && isYesterday(state.last, new Date())) ? state.streak + 1 : 1;
    var bonusNow = streakBonus(afterSignStreak);
    var btnHint = done
      ? '<p class="text-[11.5px] text-slate-500 mt-2">今天已签到，明天凌晨 0 点后可再次签到</p>'
      : '<p class="text-[11.5px] text-slate-400 mt-2">今日签到 +10' +
        (bonusNow ? '，连续签到额外 +' + bonusNow : '') + '</p>';

    mask.innerHTML =
      '<div class="nc-box nc-pop p-5">' +
        '<div class="flex items-center justify-between">' +
          '<h4 class="text-base font-semibold text-cyan-200"><i class="fa-solid fa-calendar-check mr-1.5"></i>每日签到</h4>' +
          '<button class="nc-ghost !px-2" data-nc="close" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +

        '<div class="flex gap-2 mt-4">' +
          '<div class="nc-stat"><p class="text-base sm:text-lg font-bold text-amber-300">🔥 ' + eff + '</p><p class="text-[10.5px] text-slate-400 mt-0.5">连续签到（天）</p></div>' +
          '<div class="nc-stat"><p class="text-base sm:text-lg font-bold text-cyan-300">' + state.total + '</p><p class="text-[10.5px] text-slate-400 mt-0.5">累计签到（天）</p></div>' +
          '<div class="nc-stat"><p class="text-base sm:text-lg font-bold text-emerald-300">' + state.points + '</p><p class="text-[10.5px] text-slate-400 mt-0.5">当前总积分</p></div>' +
        '</div>' +

        '<div class="mt-4 rounded-xl border border-white/10 bg-white/[.03] p-3">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<button class="nc-ghost !px-2" data-nc="prev"><i class="fa-solid fa-chevron-left"></i></button>' +
            '<p class="text-[13px] text-slate-200 font-medium">' + y + ' 年 ' + (m + 1) + ' 月</p>' +
            '<button class="nc-ghost !px-2 ' + (isCurMonth ? 'opacity-40 pointer-events-none' : '') + '" data-nc="next"><i class="fa-solid fa-chevron-right"></i></button>' +
          '</div>' +
          '<div class="nc-cal">' +
            ['日', '一', '二', '三', '四', '五', '六'].map(function (w) { return '<span class="dow">' + w + '</span>'; }).join('') +
            cellsHtml +
          '</div>' +
        '</div>' +

        '<div class="mt-4 flex items-center justify-between gap-2 flex-wrap">' +
          (done
            ? '<button class="nc-btn" style="opacity:.6;pointer-events:none"><i class="fa-solid fa-check"></i>今日已签到</button>'
            : '<button class="nc-btn" data-nc="sign"><i class="fa-solid fa-pen-nib"></i>立即签到 +10</button>') +
          '<button class="nc-ghost" data-nc="sound"><i class="fa-solid ' + (state.sound ? 'fa-volume-high' : 'fa-volume-xmark') + '"></i>' +
            (state.sound ? '音效开' : '音效关') + '</button>' +
        '</div>' +
        btnHint + progress +
      '</div>';
    mask.classList.add('show');
  }

  function openSign() {
    calCursor = null;
    renderSignModal();
  }

  /* ---------------- 游戏解锁弹窗（通用；UNO 沿用原样式与文案） ---------------- */
  var UNLOCK_META = {
    uno:      { name: 'UNO 卡牌',   icon: 'fa-layer-group',  color: 'bg-emerald-400/10 text-emerald-300', tag: 'AI 简单/普通 · WebRTC 联机 · 完整规则' },
    tiaoqi:   { name: '跳棋',       icon: 'fa-circle-nodes', color: 'bg-sky-400/10 text-sky-300',        tag: 'AI 简单/普通/困难 · WebRTC 联机' },
    doushou:  { name: '斗兽棋',     icon: 'fa-paw',          color: 'bg-orange-400/10 text-orange-300',   tag: 'AI 简单/普通/困难 · WebRTC 联机' },
    undercover: { name: '谁是卧底', icon: 'fa-user-secret',  color: 'bg-fuchsia-400/10 text-fuchsia-300', tag: '4-10 人 · 好友联机 · 语言推理' },
    heibai:   { name: '黑白棋',     icon: 'fa-circle-half-stroke', color: 'bg-teal-400/10 text-teal-300', tag: 'AI 简单/普通/困难 · WebRTC 联机' },
    langren:  { name: '狼人杀',     icon: 'fa-moon',         color: 'bg-violet-400/10 text-violet-300',   tag: '8-10 人 · 好友联机 · 夜昼博弈' },
    turtlet:  { name: '海龟汤',     icon: 'fa-mug-hot',      color: 'bg-rose-400/10 text-rose-300',        tag: '4-8 人 · 好友联机 · 汤题推理' }
  };
  var pendingGame = 'uno';

  function renderUnlockModal() {
    var game = pendingGame;
    var cost = GAME_COSTS[game];
    var meta = UNLOCK_META[game] || { name: game, icon: 'fa-gamepad', color: 'bg-cyan-400/10 text-cyan-300', tag: '' };
    var mask = ensureMask('nc-mask-unlock');
    var enough = state.points >= cost;
    var pct = Math.min(100, Math.round(state.points / cost * 100));

    mask.innerHTML =
      '<div class="nc-box nc-pop p-5 sm:p-6">' +
        '<div class="flex items-center justify-between">' +
          '<h4 class="text-base font-semibold text-cyan-200"><i class="fa-solid fa-lock mr-1.5"></i>解锁 ' + meta.name + '</h4>' +
          '<button class="nc-ghost !px-2" data-nc="close"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +

        '<div class="flex items-center gap-3 mt-4 rounded-xl border border-white/10 bg-white/[.04] p-3">' +
          '<span class="w-11 h-11 rounded-xl flex items-center justify-center text-lg ' + meta.color + '"><i class="fa-solid ' + meta.icon + '"></i></span>' +
          '<div class="flex-1">' +
            '<p class="text-sm font-semibold text-slate-100">' + meta.name + '</p>' +
            '<p class="text-[11px] text-slate-500 mt-0.5">' + meta.tag + '</p>' +
          '</div>' +
        '</div>' +

        '<div class="mt-4 flex items-center justify-between text-[13px]">' +
          '<span class="text-slate-400">解锁需要</span>' +
          '<span class="font-bold text-amber-300"><i class="fa-solid fa-star mr-0.5"></i>' + cost + ' 积分</span>' +
        '</div>' +
        '<div class="mt-1 flex items-center justify-between text-[13px]">' +
          '<span class="text-slate-400">当前拥有</span>' +
          '<span class="font-bold text-emerald-300"><i class="fa-solid fa-star mr-0.5"></i>' + state.points + ' 积分</span>' +
        '</div>' +
        '<div class="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">' +
          '<div class="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-400 transition-all" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<p class="text-[11px] text-slate-500 mt-1.5" id="nc-unlock-msg">' +
          (enough ? '积分充足，解锁后永久可玩' : '还差 ' + (cost - state.points) + ' 积分，坚持每日签到即可赚取') + '</p>' +

        '<div class="mt-5 flex justify-end gap-2">' +
          '<button class="nc-ghost" data-nc="close">再想想</button>' +
          '<button class="nc-btn" data-nc="unlock-confirm"><i class="fa-solid ' + (enough ? 'fa-key' : 'fa-circle-exclamation') + '"></i>' +
            (enough ? '确认解锁' : '积分不够') + '</button>' +
        '</div>' +
      '</div>';
    mask.classList.add('show');
  }

  function showUnlock(game) {
    game = game || 'uno';
    if (isUnlocked(game)) return;
    pendingGame = game;
    renderUnlockModal();
  }

  /* ---------------- 全局事件委托 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-nc]');
    if (!t) return;
    var act = t.getAttribute('data-nc');
    switch (act) {
      case 'close': closeMasks(); break;
      case 'mile-ok': masks['nc-mask-mile'].classList.remove('show'); break;
      case 'prev':
        calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
        renderSignModal();
        break;
      case 'next':
        calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
        renderSignModal();
        break;
      case 'sign': {
        var r = signIn();
        if (!r.ok) { toast(r.reason); break; }
        toast('签到成功！今日 +' + r.gained + ' 积分' + (r.bonus ? '（含连签加成 +' + r.bonus + '）' : ''));
        syncFab();
        renderSignModal();
        if (r.milestone) setTimeout(function () { showMilestone(r.milestone); }, 450);
        refreshLockVisuals();
        break;
      }
      case 'sound':
        state.sound = !state.sound;
        save(state);
        if (state.sound) Snd.play('sign');
        renderSignModal();
        break;
      case 'unlock-confirm': {
        var g = pendingGame;
        var u = unlockGame(g);
        if (u.ok && !u.already) {
          toast('🎉 ' + (UNLOCK_META[g] ? UNLOCK_META[g].name : g) + ' 解锁成功，剩余 ' + state.points + ' 积分，尽情游玩吧！');
          refreshLockVisuals();
          closeMasks();
        } else if (u.already) {
          refreshLockVisuals(); closeMasks();
        } else {
          var msg = document.getElementById('nc-unlock-msg');
          if (msg) { msg.textContent = u.reason; msg.className = 'text-[11.5px] text-rose-300 mt-1.5'; }
          toast(u.reason);
        }
        break;
      }
    }
  });

  /* ---------------- 悬浮挂件 ---------------- */
  function syncFab() {
    var fab = document.getElementById('nara-checkin-fab');
    if (!fab) return;
    var done = signedToday();
    fab.classList.toggle('done', done);
    fab.innerHTML = done
      ? '<i class="fa-solid fa-circle-check"></i>今日已签到'
      : '<i class="fa-solid fa-calendar-day"></i>今日签到';
  }

  /* ---------------- 锁视觉 & 门禁（通用；UNO 的 data-uno-lock 保持兼容） ---------------- */
  function lockNodes() {
    // 新游戏用 data-nc-lock="游戏id"；UNO 旧属性 data-uno-lock 等价
    var list = [];
    document.querySelectorAll('[data-nc-lock]').forEach(function (el) { list.push({ el: el, game: el.getAttribute('data-nc-lock') }); });
    document.querySelectorAll('[data-uno-lock]').forEach(function (el) { list.push({ el: el, game: 'uno' }); });
    return list;
  }

  function refreshLockVisuals() {
    lockNodes().forEach(function (item) {
      var el = item.el, game = item.game;
      var locked = !isUnlocked(game);
      el.classList.toggle('nc-locked', locked);
      el.style.position = el.style.position || 'relative';
      var badge = el.querySelector('.nc-lockbadge');
      if (locked && !badge) {
        var b = document.createElement('span');
        b.className = 'nc-lockbadge';
        b.textContent = '🔒';
        b.title = '签到攒满 ' + GAME_COSTS[game] + ' 积分可解锁';
        el.appendChild(b);
      } else if (!locked && badge) {
        badge.remove();
      }
    });
  }

  function initGates() {
    // 锚点门禁（tools.html）：锁定时拦截跳转并弹对应游戏的解锁窗
    lockNodes().forEach(function (item) {
      var el = item.el, game = item.game;
      if (el.tagName !== 'A') return;
      el.addEventListener('click', function (e) {
        if (!isUnlocked(game)) {
          e.preventDefault();
          e.stopPropagation();
          showUnlock(game);
        }
      });
    });
    refreshLockVisuals();
  }

  /* ---------------- 自动初始化 ---------------- */
  function init() {
    injectCss();
    syncFab();
    initGates();

    var fab = document.getElementById('nara-checkin-fab');
    if (fab) fab.addEventListener('click', openSign);

    // 跨标签页同步状态
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) {
        state = load();
        syncFab();
        refreshLockVisuals();
      }
    });

    // 凌晨 0 点后自动刷新挂件签到状态
    var now = new Date();
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    setTimeout(function () {
      state = load();
      syncFab();
    }, midnight - now);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------------- 对外接口（games.html 大厅按钮门禁用） ---------------- */
  window.NaraCheckin = {
    isUnlocked: isUnlocked,
    showUnlock: showUnlock,
    cost: UNO_COST,
    costs: GAME_COSTS,
    costOf: function (game) { return GAME_COSTS[game] || 0; },
    points: function () { return state.points; },
    refresh: refreshLockVisuals
  };
})();
