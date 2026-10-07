/* ==================================================================
 * 海龟汤模块（4-8 人，纯联机 · 无 AI）
 *  房主 = 汤主，公布「汤面」；其他玩家是「喝汤人」向汤主提问
 *  汤主只能回答：是 / 不是 / 无关（点按钮广播系统消息）
 *  内置题库 + 房主可自定义汤面/汤底；可切换下一题；可公布汤底
 *  联机信令：
 *    客→主 {t:'chat',x} {t:'next'} {t:'custom',face,bottom} {t:'reveal'}
 *    主→客 {t:'s',view} {t:'chat',from,name,x,sys}
 * ================================================================== */
(function () {
  'use strict';

  /* ---------------- 内置题库 ---------------- */
  var POOL = [
    { face: '一个男人走进酒吧，向酒保要了一杯水。酒保拿出一把枪指着他。男人说了声谢谢就离开了。', bottom: '男人打嗝不止，想喝水压一压。酒保看穿了他的窘境，用枪吓他一跳，嗝就止住了，所以男人谢过离开。' },
    { face: '一个男人走进餐馆，点了一份海龟汤。他喝了一口后走出餐馆，痛哭失声，随后自杀了。', bottom: '男人多年前与同伴在荒岛漂流，同伴煮了「海龟汤」给他喝才活下来。后来他得知当时的汤其实是用同伴的肉煮的，崩溃自杀。' },
    { face: '一位女子在公园长椅上发现了别人留下的半根吸管，她捡起来仔细端详，随即放声大哭。', bottom: '女子曾因吸毒导致孩子失踪多年。她认出这根吸管上有她孩子特有的咬痕，意识到孩子也在吸毒，悔恨万分。' },
    { face: '一个人买了双新鞋，第二天他死了。', bottom: '他是飞机上的机组人员，新鞋有金属部件过安检被拦下，他因赶时间脱鞋跑进舱门，落地后赤脚踩到漏电设备触电身亡。' },
    { face: '一名男子每天坐电梯到 10 楼，再爬楼梯到 15 楼的家。', bottom: '他是矮个子，够不到 15 楼的按钮，电梯最高只能按到 10 楼，所以剩下爬楼梯。' },
    { face: '一个女子在沙漠中全身赤脚，手里拿着一根折断的火柴，她死了。', bottom: '热气球漏气下坠，两人扔光所有东西仍超重，最后抽签决定谁跳下去，她抽到短火柴，跳下沙漠摔死。' },
    { face: '一名男子在深夜的房间里看书，突然停电了，他叹了口气继续看。', bottom: '他是盲人，读的是盲文，停电不影响他。他叹气是替明眼人惋惜。' },
    { face: '一位富翁在自家花园里被人谋杀，他手里紧握着一根折断的火柴。', bottom: '富翁与同伴乘热气球遇险，扔光东西仍超重，抽签决定谁跳下，他抽到短火柴，不肯跳，被同伴推下花园摔死。' },
    { face: '一个雨天，男人撑着伞走在大街上，他却全身湿透了。', bottom: '男人个子特别高，伞撑在头顶却挡不住雨，因为伞柄短，他还是被淋湿了。' },
    { face: '一个女子收到情人寄来的信，看完信后她立刻报了警。', bottom: '信里写的是「快来救我」，但地址被血浸透看不清，她意识到情人出事了，立刻报警。' },
    { face: '一名男子在办公室接到一个电话，听完之后他立刻冲出办公室，跳窗而死。', bottom: '电话里说他的妻子和孩子在火灾中丧生，他无法承受而自杀。' },
    { face: '一个小女孩生日那天收到了一只玩具熊，第二天她就死了。', bottom: '玩具熊里被变态塞了毒针，女孩拥抱时被扎中要害毒发身亡。' }
  ];

  /* ---------------- 音效（WebAudio 合成） ---------------- */
  var Snd = {
    ctx: null, on: true,
    ensure() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
      if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return this.ctx;
    },
    tone(f, dur, type, vol, delay) {
      var ctx = this.ctx, t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    play(kind) {
      if (!this.on || !this.ensure()) return;
      if (kind === 'answer') { this.tone(540, .08, 'triangle', .14, 0); this.tone(720, .08, 'triangle', .12, .06); }
      else if (kind === 'reveal') { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .15, 'triangle', .17, i * .1)); }
      else if (kind === 'next') { this.tone(440, .06, 'sine', .13, 0); this.tone(587, .08, 'sine', .13, .07); }
      else if (kind === 'chat') { this.tone(660, .05, 'triangle', .1, 0); }
    }
  };
  document.addEventListener('pointerdown', function () { Snd.ensure(); }, { passive: true });

  /* ---------------- 样式 ---------------- */
  var CSS_ID = 'tt-style';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent =
      '.tt-wrap{display:flex;flex-direction:column;gap:.7rem;height:100%}' +
      '.tt-face{background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.25);border-radius:1rem;padding:.9rem 1.1rem}' +
      '.tt-bottom{background:rgba(244,63,94,.06);border:1px solid rgba(244,63,94,.3);border-radius:1rem;padding:.9rem 1.1rem}' +
      '.tt-chat{flex:1;min-height:140px;max-height:46vh;overflow-y:auto;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:.8rem;padding:.6rem .8rem;font-size:13px;line-height:1.6}' +
      '.tt-chat::-webkit-scrollbar{width:5px}.tt-chat::-webkit-scrollbar-thumb{background:rgba(103,232,249,.3);border-radius:3px}' +
      '.tt-msg{margin-bottom:.4rem}.tt-sys{color:#fbbf24;font-style:italic}.tt-me{color:#67e8f9}.tt-other{color:#cbd5e1}' +
      '.tt-input-row{display:flex;gap:.5rem}.tt-input-row textarea{flex:1;resize:none;height:44px;max-height:120px}' +
      '.tt-ans-row{display:flex;gap:.5rem;flex-wrap:wrap}' +
      '.tt-ans-btn{flex:1;min-width:0;padding:.7rem .4rem;border-radius:.8rem;font-size:13px;font-weight:600;cursor:pointer;border:1px solid;transition:all .15s ease}' +
      '.tt-yes{background:rgba(52,211,153,.12);border-color:rgba(52,211,153,.55);color:#6ee7b7}' +
      '.tt-yes:hover{background:rgba(52,211,153,.22)}' +
      '.tt-no{background:rgba(244,63,94,.12);border-color:rgba(244,63,94,.55);color:#fda4af}' +
      '.tt-no:hover{background:rgba(244,63,94,.22)}' +
      '.tt-irr{background:rgba(148,163,184,.12);border-color:rgba(148,163,184,.5);color:#cbd5e1}' +
      '.tt-irr:hover{background:rgba(148,163,184,.22)}' +
      '@media(max-width:640px){.tt-chat{max-height:36vh;font-size:12.5px}.tt-ans-btn{padding:.6rem .3rem;font-size:12.5px}}' +
      /* 横屏：聊天框与汤面分两栏 */
      'body.orient-land .tt-wrap.lg{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-rows:auto auto auto;gap:.6rem;height:calc(100dvh - 70px)}' +
      'body.orient-land .tt-wrap.lg .tt-face{grid-column:1;grid-row:1}' +
      'body.orient-land .tt-wrap.lg .tt-bottom{grid-column:1;grid-row:2}' +
      'body.orient-land .tt-wrap.lg .tt-ans-row{grid-column:1;grid-row:3}' +
      'body.orient-land .tt-wrap.lg .tt-chat{grid-column:2;grid-row:1/4;max-height:none}' +
      'body.orient-land .tt-wrap.lg .tt-input-row{grid-column:2;grid-row:3}';
    document.head.appendChild(s);
  }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 状态 ---------------- */
  var inst = null;

  function makeInst(opts) {
    injectCSS();
    var mount = opts.mount;
    var isHost = opts.seat === 0;
    var mySeat = opts.seat;
    var count = opts.count;
    var room = opts.room;
    var toast = opts.toast || function () {};

    var st = {
      phase: 'play',
      master: 0,
      qIdx: 0,
      face: '',
      bottom: '',
      revealed: false,
      chat: [],
      myName: '玩家' + (mySeat + 1)
    };

    /* 内置题库洗牌 */
    var pool = shuffle(POOL.slice());
    function pickQ(idx) {
      var q = pool[idx % pool.length];
      st.face = q.face;
      st.bottom = q.bottom;
      st.revealed = false;
      st.phase = 'play';
    }

    function pushSys(text) {
      st.chat.push({ sys: true, text: text });
    }
    function pushChat(name, x, me) {
      st.chat.push({ name: name, x: x, me: !!me });
    }

    /* 房主初始化第一题 */
    if (isHost) {
      pickQ(0);
      pushSys('汤主公布新汤题，请喝汤人开始提问！');
    }

    /* ---------------- 网络事件 ---------------- */
    if (room) {
      room.on('data', function (msg, seat) {
        if (!msg || typeof msg !== 'object') return;
        /* 房主广播的视图：客端应用并渲染 */
        if (!isHost && msg.t === 's' && msg.view) {
          applyView(msg.view);
          return;
        }
        if (msg.t === 'chat' && typeof msg.x === 'string') {
          var name = '玩家' + (seat + 1);
          pushChat(name, msg.x, false);
          if (isHost) broadcastView();
          else render();
        } else if (msg.t === 'next' && isHost) {
          actNext();
        } else if (msg.t === 'custom' && isHost && typeof msg.face === 'string' && typeof msg.bottom === 'string') {
          st.face = msg.face; st.bottom = msg.bottom; st.revealed = false; st.phase = 'play';
          pushSys('汤主切换到自定义汤题');
          if (isHost) broadcastView();
          render();
        } else if (msg.t === 'reveal' && isHost) {
          actReveal();
        }
      });
      room.on('leave', function (seat) {
        pushSys('玩家' + (seat + 1) + ' 离开了房间');
        render();
      });
    }

    /* ---------------- 房主广播视图 ---------------- */
    function makeView() {
      return {
        phase: st.phase,
        master: st.master,
        face: st.face,
        bottom: st.revealed ? st.bottom : '',
        revealed: st.revealed,
        chat: st.chat.slice()
      };
    }
    function broadcastView() {
      if (!room || !isHost) return;
      room.send({ t: 's', view: makeView() });
      render();
    }

    /* ---------------- 玩家动作 ---------------- */
    function sendChat() {
      var ta = mount.querySelector('.tt-input-row textarea');
      if (!ta) return;
      var x = ta.value.trim();
      if (!x) return;
      pushChat(st.myName, x, true);
      ta.value = '';
      Snd.play('chat');
      if (isHost) {
        broadcastView();
      } else if (room) {
        room.send({ t: 'chat', x: x });
      }
      render();
    }

    /* 汤主回答 */
    function answer(kind) {
      if (!isHost) return;
      var label = kind === 'yes' ? '是' : (kind === 'no' ? '不是' : '无关');
      pushSys('汤主回答：' + label);
      Snd.play('answer');
      broadcastView();
    }

    function actNext() {
      if (!isHost) return;
      st.qIdx = (st.qIdx + 1) % pool.length;
      pickQ(st.qIdx);
      pushSys('汤主切换到下一道汤题，请喝汤人重新提问');
      Snd.play('next');
      broadcastView();
    }
    function actReveal() {
      if (!isHost) return;
      st.revealed = true;
      st.phase = 'reveal';
      pushSys('汤主公布汤底，本回合结束');
      Snd.play('reveal');
      broadcastView();
    }
    function actCustom(face, bottom) {
      if (!isHost) return;
      st.face = face; st.bottom = bottom; st.revealed = false; st.phase = 'play';
      pushSys('汤主切换到自定义汤题');
      broadcastView();
    }

    /* 客端接收房主视图 */
    function applyView(v) {
      if (!v) return;
      st.phase = v.phase;
      st.master = v.master;
      st.face = v.face;
      if (v.revealed) { st.bottom = v.bottom; st.revealed = true; } else { st.revealed = false; }
      st.chat = v.chat || [];
      render();
    }
    if (!isHost && room) {
      /* 客端拦截房主视图消息 */
      var origData = room._handlers && room._handlers.data;
    }

    /* ---------------- 渲染 ---------------- */
    function render() {
      var land = document.body.classList.contains('orient-land');
      var landClass = land ? ' lg' : '';
      var isMaster = isHost;
      var faceCard = '<div class="tt-face"><p class="text-[11px] text-amber-300/80 mb-1"><i class="fa-solid fa-bowl-food mr-1"></i>汤面</p><p class="text-[13px] text-slate-100 leading-relaxed">' + esc(st.face || '（等待汤主公布）') + '</p></div>';
      var bottomCard = '';
      if (isMaster || st.revealed) {
        bottomCard = '<div class="tt-bottom"><p class="text-[11px] text-rose-300/80 mb-1"><i class="fa-solid fa-key mr-1"></i>' + (st.revealed ? '汤底（已公布）' : '汤底（仅汤主可见）') + '</p><p class="text-[13px] text-slate-100 leading-relaxed">' + esc(st.bottom || '') + '</p></div>';
      }
      /* 汤主操作区 */
      var masterBar = '';
      if (isMaster) {
        var ansRow = '<div class="tt-ans-row">' +
          '<button class="tt-ans-btn tt-yes" data-act="yes"><i class="fa-solid fa-check"></i> 是</button>' +
          '<button class="tt-ans-btn tt-no" data-act="no"><i class="fa-solid fa-xmark"></i> 不是</button>' +
          '<button class="tt-ans-btn tt-irr" data-act="irr"><i class="fa-solid fa-circle-question"></i> 无关</button>' +
        '</div>';
        var ctrlRow = '<div class="flex gap-2 flex-wrap">' +
          '<button class="btn-ghost" data-act="next"><i class="fa-solid fa-forward"></i>下一题</button>' +
          '<button class="btn-ghost" data-act="custom"><i class="fa-solid fa-pen"></i>自定义汤题</button>' +
          '<button class="btn-primary" data-act="reveal"><i class="fa-solid fa-eye"></i>公布汤底</button>' +
        '</div>';
        masterBar = ansRow + ctrlRow;
      }
      /* 聊天区 */
      var chatHtml = '<div class="tt-chat">';
      st.chat.forEach(function (m) {
        if (m.sys) chatHtml += '<div class="tt-msg tt-sys">—— ' + esc(m.text) + ' ——</div>';
        else chatHtml += '<div class="tt-msg ' + (m.me ? 'tt-me' : 'tt-other') + '"><b>' + esc(m.name) + '：</b>' + esc(m.x) + '</div>';
      });
      chatHtml += '</div>';
      /* 输入区 */
      var inputRow = '<div class="tt-input-row"><textarea class="tool-input" placeholder="向汤主提问…（' + (isMaster ? '你是汤主' : '汤主只能回答 是/不是/无关') + '）"></textarea><button class="btn-primary" data-act="send"><i class="fa-solid fa-paper-plane"></i></button></div>';

      mount.innerHTML = '<div class="tt-wrap' + landClass + '">' + faceCard + bottomCard + masterBar + chatHtml + inputRow + '</div>';

      /* 滚到底 */
      var chatEl = mount.querySelector('.tt-chat');
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

      /* 保留输入框 value/focus */
      var ta = mount.querySelector('.tt-input-row textarea');
      if (ta && inst._taValue) { ta.value = inst._taValue; }

      /* 绑定 */
      mount.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'send') {
            var t = ta.value.trim();
            if (!t) { toast('请输入内容'); return; }
            inst._taValue = '';
            sendChat();
          } else if (a === 'yes' || a === 'no' || a === 'irr') {
            answer(a);
          } else if (a === 'next') {
            if (!isHost) return;
            actNext();
          } else if (a === 'reveal') {
            if (!isHost) return;
            actReveal();
          } else if (a === 'custom') {
            if (!isHost) return;
            openCustomDialog();
          }
        });
      });
      /* 输入框保留 */
      if (ta) {
        ta.addEventListener('input', function () { inst._taValue = ta.value; });
        ta.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            mount.querySelector('[data-act="send"]').click();
          }
        });
      }
    }

    /* ---------------- 自定义汤题弹窗 ---------------- */
    function openCustomDialog() {
      var mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(2,6,23,.66);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem';
      mask.innerHTML = '<div style="width:100%;max-width:480px;max-height:84vh;overflow-y:auto;background:rgba(15,23,42,.96);border:1px solid rgba(103,232,249,.25);border-radius:1.1rem;padding:1.25rem;box-shadow:0 20px 60px rgba(2,8,23,.6)">' +
        '<h3 class="text-sm font-semibold text-slate-100 mb-3"><i class="fa-solid fa-pen text-cyan-300 mr-1"></i>自定义汤题</h3>' +
        '<label class="text-[11px] text-slate-400 block mb-1">汤面（情境描述）</label>' +
        '<textarea id="tt-c-face" rows="3" class="tool-input mb-3" placeholder="请输入汤面…"></textarea>' +
        '<label class="text-[11px] text-slate-400 block mb-1">汤底（真相）</label>' +
        '<textarea id="tt-c-bottom" rows="3" class="tool-input mb-3" placeholder="请输入汤底…"></textarea>' +
        '<div class="flex justify-center gap-2"><button class="btn-ghost" id="tt-c-cancel">取消</button><button class="btn-primary" id="tt-c-ok"><i class="fa-solid fa-check"></i>开始</button></div>' +
      '</div>';
      document.body.appendChild(mask);
      mask.querySelector('#tt-c-cancel').addEventListener('click', function () { mask.remove(); });
      mask.querySelector('#tt-c-ok').addEventListener('click', function () {
        var f = mask.querySelector('#tt-c-face').value.trim();
        var b = mask.querySelector('#tt-c-bottom').value.trim();
        if (!f || !b) { toast('汤面和汤底不能为空'); return; }
        actCustom(f, b);
        mask.remove();
      });
      mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    }

    /* ---------------- 客端视图接收覆盖 ---------------- */
    /* 客端的 t:'s' view 已在 on('data') 回调中统一处理，无需额外补丁 */

    /* ---------------- 启动 ---------------- */
    inst = {
      mySeat: mySeat,
      isHost: isHost,
      mount: mount,
      st: st,
      sendChat: sendChat,
      answer: answer,
      actNext: actNext,
      actReveal: actReveal,
      actCustom: actCustom,
      applyView: applyView,
      render: render
    };

    /* 房主首屏渲染 */
    if (isHost) {
      pushSys('你是汤主，请回答喝汤人的提问：是 / 不是 / 无关');
      render();
    } else {
      render();
    }

    return inst;
  }

  /* ---------------- 出口 ---------------- */
  window.GG = window.GG || {};
  window.GG.turtlet = {
    _inst: null,
    start(mount, opts) {
      this.stop();
      this._inst = makeInst(opts);
      return this._inst;
    },
    stop() {
      if (this._inst && this._inst.mount) {
        this._inst.mount.innerHTML = '';
      }
      this._inst = null;
    }
  };
})();
