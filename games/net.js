/* ==================================================================
 * 奈良棋类桌游厅 · 联机层
 *  - NetRoom：房间号匹配（PeerJS，底层即 WebRTC RTCPeerConnection / DataChannel）
 *  - ManualRoom：手动信令（纯 WebRTC + 公共 STUN，零第三方服务器兜底）
 * 游戏模块只依赖统一接口：on / once / send / destroy / code
 * ================================================================== */
(function () {
  'use strict';

  /* ---------------- 事件发射器 ---------------- */
  class Emitter {
    constructor() { this._map = new Map(); }
    on(evt, cb) {
      if (!this._map.has(evt)) this._map.set(evt, new Set());
      this._map.get(evt).add(cb);
      return () => this.off(evt, cb);
    }
    once(evt, cb) {
      const un = this.on(evt, function wrap() {
        un();
        cb.apply(null, arguments);
      });
      return un;
    }
    off(evt, cb) {
      const set = this._map.get(evt);
      if (set) set.delete(cb);
    }
    emit(evt) {
      const args = Array.prototype.slice.call(arguments, 1);
      const set = this._map.get(evt);
      if (set) set.forEach(cb => { try { cb.apply(null, args); } catch (e) { console.error(e); } });
    }
    removeAll() { this._map.clear(); }
  }

  function genCode() {
    return String(Math.floor(Math.random() * 900000) + 100000);
  }

  /* ==================================================================
   * NetRoom —— 房间号匹配
   * ================================================================== */
  const PEER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
  let peerLoading = null;

  class NetRoom extends Emitter {
    constructor(gameId, maxPeers) {
      super();
      this.gameId = gameId;
      this.maxPeers = maxPeers || 1;   // >1 时为多人房间（星型拓扑，房主中转）
      this.code = null;
      this.peer = null;
      this.conn = null;
      this.conns = new Map();          // 多人模式：seat -> conn（仅房主侧）
      this.locked = false;             // 开局后锁定，拒绝新加入
      this._dead = false;
    }

    static ensureLib() {
      if (window.Peer) return Promise.resolve();
      if (peerLoading) return peerLoading;
      peerLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEER_CDN;
        s.onload = resolve;
        s.onerror = () => { peerLoading = null; reject(new Error('联机组件加载失败，请检查网络')); };
        document.head.appendChild(s);
      });
      return peerLoading;
    }

    /* 房主：生成房间号；房间号撞号时自动更换重试 */
    host() {
      const self = this;
      return new Promise((resolve, reject) => {
        let tries = 0;
        function tryCreate() {
          const code = genCode();
          const id = 'nara-' + self.gameId + '-' + code;
          let settled = false;
          let peer;
          try {
            peer = new Peer(id, { debug: 1 });
          } catch (e) { reject(e); return; }
          self.peer = peer;

          peer.on('open', () => {
            if (settled || self._dead) return;
            settled = true;
            self.code = code;
            peer.on('connection', conn => self._accept(conn));
            resolve(code);
          });
          peer.on('error', err => {
            if (settled) { self._onPeerError(err); return; }
            if (err && err.type === 'unavailable-id' && tries < 8) {
              tries++;
              try { peer.destroy(); } catch (e) {}
              tryCreate();
            } else {
              reject(new Error('房间创建失败，请稍后重试'));
            }
          });
        }
        tryCreate();
      });
    }

    _accept(conn) {
      if (this.maxPeers > 1) { this._acceptMulti(conn); return; }
      if (this.conn) {
        // 仅支持两人对局，多余连接直接关闭
        try { conn.close(); } catch (e) {}
        return;
      }
      this.conn = conn;
      conn.on('open', () => this.emit('connected'));
      conn.on('data', data => this.emit('data', data));
      conn.on('close', () => this._handleClose());
      conn.on('error', () => this._handleClose());
    }

    /* 多人房间：房主侧接受多个连接，座位号取最小空位（1..maxPeers） */
    _acceptMulti(conn) {
      const self = this;
      const reject = () => {
        const bye = () => {
          try { conn.send({ t: 'full' }); } catch (e) {}
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 300);
        };
        if (conn.open) bye(); else conn.on('open', bye);
      };
      if (this.locked || this.conns.size >= this.maxPeers) { reject(); return; }

      const ready = () => {
        if (self._dead) return;
        if (self.locked || self.conns.size >= self.maxPeers) { reject(); return; }
        let seat = 1;
        while (self.conns.has(seat)) seat++;
        self.conns.set(seat, conn);
        conn._naraSeat = seat;
        self.emit('join', seat);
      };
      if (conn.open) ready(); else conn.on('open', ready);

      conn.on('data', d => self.emit('data', d, conn._naraSeat));
      const bye = () => {
        const seat = conn._naraSeat;
        if (seat && self.conns.get(seat) === conn) {
          self.conns.delete(seat);
          self.emit('leave', seat);
        }
      };
      conn.on('close', bye);
      conn.on('error', bye);
    }

    /* 锁定房间并把连接座位号紧凑重排为 1..N（开局时调用） */
    lock() {
      this.locked = true;
      if (this.maxPeers > 1 && this.conns.size) {
        const list = Array.from(this.conns.values());
        this.conns.clear();
        list.forEach((c, i) => { c._naraSeat = i + 1; this.conns.set(i + 1, c); });
      }
    }

    peerCount() { return this.conns.size; }

    sendTo(seat, obj) {
      const c = this.conns.get(seat);
      if (c && c.open) { c.send(obj); return true; }
      return false;
    }

    /* 加入方 */
    join(code) {
      const self = this;
      return new Promise((resolve, reject) => {
        let peer;
        try {
          peer = new Peer({ debug: 1 });
        } catch (e) { reject(e); return; }
        self.peer = peer;
        self.code = code;
        let failed = false;

        peer.on('open', () => {
          const target = 'nara-' + self.gameId + '-' + code;
          let conn;
          try {
            conn = peer.connect(target, { reliable: true });
          } catch (e) { reject(e); return; }
          self.conn = conn;

          conn.on('open', () => { if (!failed) resolve(); });
          conn.on('data', data => self.emit('data', data));
          conn.on('close', () => self._handleClose());
          conn.on('error', () => self._handleClose());
        });
        peer.on('error', err => {
          if (failed) return;
          failed = true;
          if (err && err.type === 'peer-unavailable') {
            reject(new Error('房间号不存在，或房主尚未创建房间'));
          } else if (err && err.type === 'network') {
            reject(new Error('网络不可用，联机失败'));
          } else {
            reject(new Error('加入房间失败，请确认房间号是否正确'));
          }
        });
      });
    }

    _onPeerError(err) {
      // 对局建立后的错误：仅严重错误时触发关闭
      if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
        this.emit('error', err);
      }
    }

    _handleClose() {
      if (this._dead) return;
      this.emit('close');
    }

    send(obj) {
      if (this.maxPeers > 1 && this.conns.size) {
        let ok = false;
        this.conns.forEach(c => { if (c.open) { c.send(obj); ok = true; } });
        return ok;
      }
      if (this.conn && this.conn.open) {
        this.conn.send(obj);
        return true;
      }
      return false;
    }

    destroy() {
      this._dead = true;
      try { if (this.conn) this.conn.close(); } catch (e) {}
      this.conns.forEach(c => { try { c.close(); } catch (e) {} });
      this.conns.clear();
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.removeAll();
    }
  }

  /* ==================================================================
   * ManualRoom —— 手动信令（真正的零服务器 WebRTC）
   * ================================================================== */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' }
  ];

  function encodeBlob(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  function decodeBlob(blob) {
    return JSON.parse(decodeURIComponent(escape(atob(blob.trim()))));
  }
  function waitGathering(pc) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const check = () => {
        if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 4000);
    });
  }

  class ManualRoom extends Emitter {
    constructor(gameId) {
      super();
      this.gameId = gameId;
      this.code = genCode();
      this.pc = null;
      this.dc = null;
      this._dead = false;
    }

    _newPC() {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this._handleClose();
        }
      };
      return pc;
    }

    _wireDC(dc) {
      this.dc = dc;
      dc.onopen = () => this.emit('connected');
      dc.onmessage = e => {
        let d = e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) {} }
        this.emit('data', d);
      };
      dc.onclose = () => this._handleClose();
    }

    /* 房主：生成邀请信令文本 */
    async host() {
      const pc = this._newPC();
      const dc = pc.createDataChannel('nara');
      this._wireDC(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitGathering(pc);
      return encodeBlob({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    /* 房主：粘贴应答信令；等待通道真正打开 */
    async acceptAnswer(blob) {
      const ans = decodeBlob(blob);
      await this.pc.setRemoteDescription(new RTCSessionDescription(ans));
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('连接超时，双方需处于同一网络或使用房间号匹配')), 12000);
        this.once('connected', () => { clearTimeout(to); resolve(); });
      });
    }

    /* 加入方：根据邀请信令生成应答信令文本 */
    async join(offerBlob) {
      const offer = decodeBlob(offerBlob);
      const pc = this._newPC();
      pc.ondatachannel = e => this._wireDC(e.channel);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitGathering(pc);
      return encodeBlob({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    onceConnected(cb) {
      if (this.dc && this.dc.readyState === 'open') cb();
      else this.once('connected', cb);
    }

    _handleClose() {
      if (this._dead) return;
      this.emit('close');
    }

    send(obj) {
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    destroy() {
      this._dead = true;
      try { if (this.dc) this.dc.close(); } catch (e) {}
      try { if (this.pc) this.pc.close(); } catch (e) {}
      this.removeAll();
    }
  }

  window.NetRoom = NetRoom;
  window.ManualRoom = ManualRoom;
})();
