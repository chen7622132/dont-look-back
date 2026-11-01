/* ============================================================
   别回头 — 交互式恐怖体验
   设计依据（可查证的电影声音/剪辑手法）：
   - 惊吓三段式：铺陈（抽走声音）→ 误导（视线被引走）→ 突袭（0.1s 内完成）
   - 声音配方：17Hz 级次声铺垫 + 8kHz 级高频尖叫，对比制造"内耳失衡"
   - 视觉 3-2-1：慢推 → 定格留白 → 极短黑帧 → 切出主体
   - 负空间与边缘视觉：把威胁放在画面边缘，逼观众自己去找
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var puppet = $('#puppet');
  var parallax = document.querySelector('.parallax');
  var slices = $('#slices');
  var flash = $('#flash');
  var blood = $('#blood');
  var dot = $('#dot');
  var grain = $('#grain');
  var endEl = $('#end');
  var exitBtn = $('#exit');
  var againBtn = $('#again');
  var knowEl = $('#know');
  var crashEl = $('#crash');
  var crashLog = $('#crashlog');
  var eyeShot = $('#eyeShot');
  var tape = $('#tape');

  var R = {
    tension: 0,
    busy: false,
    hunt: false,
    dead: false,
    started: false,
    pointer: { x: 0.5, y: 0.5 },
    tilt: { g: 0, b: 0, on: false }
  };

  /* 它记得你来过几次 */
  var SEEN = 0;
  try {
    SEEN = parseInt(window.localStorage.getItem('blh_seen') || '0', 10) || 0;
    window.localStorage.setItem('blh_seen', String(SEEN + 1));
  } catch (e) { SEEN = 0; }

  var timers = [];
  /* 重返者的"台词"：次数越多，它越不客气。
     这是多周目恐怖最省力的做法 —— 不改任何机制，只让"它记得你"这件事变得更明确。 */
  function comebackLine() {
    if (SEEN >= 5) return '你每次都会回来。我知道。';
    if (SEEN >= 3) return '你不用再来了 —— 但你会来。';
    if (SEEN >= 1) return '第 ' + (SEEN + 1) + ' 次了，你还是回来了';
    return '';
  }

  function later(fn, ms) {
    var id = setTimeout(function () {
      timers = timers.filter(function (x) { return x !== id; });
      if (!R.dead) fn();
    }, ms);
    timers.push(id);
    return id;
  }
  function wait(ms) {
    return new Promise(function (res) { later(res, ms); });
  }
  function raf2() {
    return new Promise(function (res) {
      requestAnimationFrame(function () { requestAnimationFrame(res); });
    });
  }
  function clearAll() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* ---------------- 面部状态机 ---------------- */
  function setFace(o) {
    for (var k in o) {
      if (k === 'br') continue;                 // 亮度改由 .dimmer 承担
      puppet.style.setProperty('--' + k, o[k]);
    }
    if (o.br !== undefined) {
      var dim = 1 - o.br;
      if (dim < 0) dim = 0;
      if (dim > 0.94) dim = 0.94;
      puppet.style.setProperty('--dim', dim.toFixed(3));
    }
  }

  /* ---------------- 音频引擎（纯合成，无外部文件） ---------------- */
  var audio = {
    ctx: null,
    master: null,
    droneGain: null,
    noise: null,
    _beat: 0,

    _curve: function (k) {
      var n = 1024, c = new Float32Array(n), i, x;
      for (i = 0; i < n; i++) { x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
      return c;
    },

    unlock: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) {
        try { this.ctx = new AC(); } catch (e) { return false; }
        this.noise = this._makeNoise(3);
        this._build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.ctx.state === 'running' && !this.started) {
        this.started = true;
        this._beat = 0;
        this._heart();
      }
      this.loadLaugh();   // 和解码不依赖播放状态，先下下来
      return this.ctx.state === 'running';
    },

    _makeNoise: function (dur) {
      var ctx = this.ctx;
      var n = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    },

    _build: function () {
      var ctx = this.ctx;

      var master = this.master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);

      // ---- 次声级压迫（手机扬声器放不出 32Hz，靠 55Hz 的谐波占便宜）
      var dg = this.droneGain = ctx.createGain();
      dg.gain.value = 0.0;   // 开场要"宁静"，恐怖底噪留到突变前才拉起来
      dg.connect(master);

      [55, 55.7].forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 320;
        lp.Q.value = 4;
        o.connect(lp);
        lp.connect(dg);
        o.start();
      });

      // 极慢的呼吸（0.075Hz ≈ 13 秒一次）
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 0.075;
      var lg = ctx.createGain();
      lg.gain.value = 0.07;
      lfo.connect(lg);
      lg.connect(dg.gain);
      lfo.start();

      // ---- 8kHz 耳鸣层：让耳朵"听不懂但难受"
      var n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 8100;
      bp.Q.value = 18;
      var ng = ctx.createGain();
      ng.gain.value = 0.012;
      n.connect(bp); bp.connect(ng); ng.connect(master);
      n.start();

      // 缓慢升到可闻
      var g = master.gain;
      g.setValueAtTime(0.0001, ctx.currentTime);
      g.exponentialRampToValueAtTime(0.16, ctx.currentTime + 3.0);   // 开场是"一段普通录像"的音量，不是恐怖片

      // 音频能量分析：让画面跟着声音一起疯
      var ana = ctx.createAnalyser();
      ana.fftSize = 512;
      ana.smoothingTimeConstant = 0.5;
      this.analyser = ana;
      this._abuf = new Uint8Array(ana.fftSize);
      master.connect(ana);
    },

    energy: function () {
      if (!this.analyser) return 0;
      this.analyser.getByteTimeDomainData(this._abuf);
      var sum = 0, n = this._abuf.length, i, v;
      for (i = 0; i < n; i++) {
        v = (this._abuf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / n) * 3.4);
    },

    _heart: function () {
      var self = this;
      var ctx = this.ctx;
      if (!ctx) return;
      var t = ctx.currentTime;
      var bpm = 50 + R.tension * 62;
      [0, 0.235].forEach(function (d, i) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        var f = i === 0 ? 62 : 46;
        o.frequency.setValueAtTime(f, t + d);
        o.frequency.exponentialRampToValueAtTime(f * 0.62, t + d + 0.18);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.linearRampToValueAtTime(i === 0 ? 0.34 : 0.2, t + d + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.34);
        o.connect(g); g.connect(self.master);
        o.start(t + d); o.stop(t + d + 0.4);
      });
      setTimeout(function () {
        if (!R.dead && self.ctx && self.ctx.state === 'running') self._heart();
      }, Math.max(360, 60000 / bpm));
    },

    scare: function (power) {
      var ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      var self = this;
      var t = ctx.currentTime;
      var out = ctx.createGain();
      // 立体声：尖叫从一只耳朵甩到另一只，戴着耳机的人会本能扭头
      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.setValueAtTime(Math.random() > 0.5 ? -1 : 1, t);
        pan.pan.linearRampToValueAtTime(0, t + 0.14);
        out.connect(pan);
        pan.connect(this.master);
      } else {
        out.connect(this.master);
      }

      // 1) 高频尖叫噪声（主体）
      var src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.05;
      bp.frequency.setValueAtTime(760, t);
      bp.frequency.exponentialRampToValueAtTime(5400, t + 0.13);
      bp.frequency.exponentialRampToValueAtTime(1350, t + 0.95);
      var sh = ctx.createWaveShaper();
      sh.curve = this._curve(80);
      sh.oversample = '2x';
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.95, t);
      g1.gain.exponentialRampToValueAtTime(0.02, t + 1.05);
      src.connect(bp); bp.connect(sh); sh.connect(g1); g1.connect(out);

      // 2) 人声化的锯齿扫频
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(235, t);
      osc.frequency.exponentialRampToValueAtTime(1560, t + 0.085);
      osc.frequency.exponentialRampToValueAtTime(540, t + 0.86);
      var vib = ctx.createOscillator();
      vib.frequency.value = 16;
      var vibG = ctx.createGain();
      vibG.gain.value = 60;
      vib.connect(vibG); vibG.connect(osc.frequency);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.17, t);
      g2.gain.exponentialRampToValueAtTime(0.008, t + 0.9);
      osc.connect(g2); g2.connect(out);

      // 3) 胸腔冲击
      var boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(120, t);
      boom.frequency.exponentialRampToValueAtTime(27, t + 0.5);
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(1.0, t);
      g3.gain.exponentialRampToValueAtTime(0.01, t + 0.9);
      boom.connect(g3); g3.connect(out);

      // 总包络：12ms 起振 → 硬顶 0.4s → 抽走
      var p = power || 1;
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.6 * p, t + 0.012);
      out.gain.setValueAtTime(0.6 * p, t + 0.38);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);

      src.start(t); osc.start(t); vib.start(t); boom.start(t);
      src.stop(t + 1.2); osc.stop(t + 1.2); vib.stop(t + 1.2); boom.stop(t + 1.2);

      // 尖叫之后紧跟一段耳鸣（听觉残响，比静音更难受）
      later(function () {
        if (!self.ctx || self.ctx.state !== 'running') return;
        var tt = self.ctx.currentTime;
        var o2 = self.ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 6600;
        var gg = self.ctx.createGain();
        gg.gain.setValueAtTime(0.0001, tt);
        gg.gain.linearRampToValueAtTime(0.02, tt + 0.25);
        gg.gain.exponentialRampToValueAtTime(0.0001, tt + 2.6);
        o2.connect(gg); gg.connect(self.master);
        o2.start(tt); o2.stop(tt + 2.7);
      }, 900);
    },

    /* 狂笑：三层共振峰合成 —— 低沉的"嗬" + 中频的"哈哈" + 高频的尖笑 */
    laugh: function (opt) {
      var ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      opt = opt || {};
      var self = this;
      var layers = opt.layers || [
        { n: 5, pitch: 128, rate: 0.19, gain: 0.13 },
        { n: 8, pitch: 205, rate: 0.135, gain: 0.15 },
        { n: 13, pitch: 345, rate: 0.078, gain: 0.07 }
      ];
      var t0 = ctx.currentTime + 0.02;
      var FORM = [[720, 1.0], [1200, 0.62], [2600, 0.32]];
      var maxDur = 0;

      layers.forEach(function (L) {
        if (L.n * L.rate > maxDur) maxDur = L.n * L.rate;
        for (var i = 0; i < L.n; i++) {
          var t = t0 + i * L.rate;
          var f0 = L.pitch * (1 + i * 0.055) * (0.94 + Math.random() * 0.12);

          var o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f0 * 0.82, t);
          o.frequency.linearRampToValueAtTime(f0 * 1.18, t + 0.028);
          o.frequency.linearRampToValueAtTime(f0 * 0.78, t + L.rate * 0.9);

          var env = ctx.createGain();
          env.gain.setValueAtTime(0.0001, t);
          env.gain.linearRampToValueAtTime(L.gain, t + 0.013);
          env.gain.exponentialRampToValueAtTime(0.0001, t + L.rate * 0.86);

          FORM.forEach(function (F) {
            var bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = F[0];
            bp.Q.value = 5.5;
            var g = ctx.createGain();
            g.gain.value = F[1];
            o.connect(bp); bp.connect(g); g.connect(env);
          });
          env.connect(self.master);
          o.start(t); o.stop(t + L.rate);
        }
      });

      // 气声：笑的时候那口气
      var ns = ctx.createBufferSource();
      ns.buffer = this.noise;
      ns.loop = true;
      var nb = ctx.createBiquadFilter();
      nb.type = 'bandpass';
      nb.frequency.value = 2100;
      nb.Q.value = 1.6;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(0.032, t0 + 0.15);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + maxDur + 0.2);
      ns.connect(nb); nb.connect(ng); ng.connect(this.master);
      ns.start(t0); ns.stop(t0 + maxDur + 0.3);

      // 笑到一半被掐断：音频时钟上精准静音 45ms，像被掐住脖子
      var cutT = t0 + Math.min(maxDur * 0.72, 0.95);
      var mg = this.master.gain;
      mg.setValueAtTime(0.42, cutT);
      mg.linearRampToValueAtTime(0.0001, cutT + 0.04);
      mg.setValueAtTime(0.0001, cutT + 0.11);
      mg.linearRampToValueAtTime(0.42, cutT + 0.55);
    },

    /* 真实笑声录音（CC0）：三个声部同时播，像不止一个人在笑 */
    loadLaugh: function () {
      var self = this;
      if (!this.ctx || this._laughLoading || this.laughBufs) return;
      this._laughLoading = true;
      var files = ['audio/laugh_mid.mp3', 'audio/laugh_low.mp3', 'audio/laugh_high.mp3', 'audio/laugh_long.mp3'];
      var bufs = [];
      var done = 0;
      files.forEach(function (f, i) {
        fetch(f)
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (ab) { return self.ctx.decodeAudioData(ab); })
          .then(function (buf) {
            if (i < 3) {
              bufs[i] = buf;
              if (++done === 3) self.laughBufs = bufs;
            } else {
              self.laughLongBuf = buf;   // 16 秒版：给猎捕期做背景
            }
          })
          .catch(function () { /* 静默失败，回落到合成音 */ });
      });
    },

    /* 背景里的长笑声：它一直在笑，只是你刚才没注意 */
    startAmbientLaugh: function () {
      var ctx = this.ctx;
      if (!ctx || this._amb || !this.laughLongBuf) return;
      var src = ctx.createBufferSource();
      src.buffer = this.laughLongBuf;
      src.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1700;          // 闷住，像从墙那边传过来
      var g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start();
      this._amb = { src: src, gain: g };
    },

    pulseAmbient: function (level) {
      if (!this._amb || !this.ctx) return;
      var g = this._amb.gain.gain;
      var now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.linearRampToValueAtTime(level, now + 0.9);
      g.linearRampToValueAtTime(0.0001, now + 3.6);
    },

    stopAmbient: function () {
      if (!this._amb) return;
      try { this._amb.src.stop(); } catch (e) {}
      this._amb = null;
    },

    /* 室内环境音：空调的低频嗡鸣 + 一丝空气声。
       开场伪装成普通录像时用它 —— 有声音才像"真的在放视频"，但这个声音不带任何威胁。 */
    room: function () {
      if (!this.ctx || !this.master || this.roomGain) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 430; lp.Q.value = 0.6;
      var g = ctx.createGain(); g.gain.value = 0.0001;
      n.connect(lp); lp.connect(g); g.connect(this.master);
      n.start(t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 2.4);
      this.roomGain = g;
    },

    // 把室内音压掉（突变那一刻）
    roomOff: function () {
      if (!this.ctx || !this.roomGain) return;
      var g = this.roomGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + 0.06);
    },

    /* ---- 铺垫四件套 ---- */

    // 低频压迫缓慢加深。20~30 秒内几乎察觉不到在变响，但身体会先反应过来
    droneRamp: function (target, sec) {
      if (!this.ctx || !this.droneGain) return;
      var g = this.droneGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(Math.max(0.0001, target), t + (sec || 20));
    },

    // 假警报：一记短促的高频刺，90ms 收掉。不给实体，只给"刚才那是什么"
    sting: function (level) {
      if (!this.ctx || !this.master) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var lv = (level === undefined) ? 0.20 : level;
      var self = this;
      [1240, 2610].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.085);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(lv / (i + 1.3), t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);
        o.connect(g); g.connect(self.master);
        o.start(t); o.stop(t + 0.11);
      });
    },

    // 抽空：25ms 内把整条总线抽干，只剩一线空气声。比渐弱可怕得多
    suck: function () {
      if (!this.ctx || !this.master) return;
      var g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.012, t + 0.025);
    },

    // 从抽空里回来。瞬间恢复（15ms）才不会吃掉尖叫的起音
    revive: function (target, sec) {
      if (!this.ctx || !this.master) return;
      var g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(target || 0.55, t + (sec || 0.015));
    },

    playLaugh: function (power) {
      var ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      if (!this.laughBufs) { this.laugh(); return; }   // 录音没就绪就先用合成的

      var self = this;
      var t = ctx.currentTime + 0.01;
      var p = power || 1;
      var cfg = [
        { i: 0, gain: 0.85, delay: 0,    pan: -0.35 },
        { i: 1, gain: 0.65, delay: 0.055, pan: 0.45 },
        { i: 2, gain: 0.45, delay: 0.115, pan: 0.1 }
      ];

      cfg.forEach(function (c) {
        var buf = self.laughBufs[c.i];
        if (!buf) return;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.97 + Math.random() * 0.06;   // 每个声部微错开

        var g = ctx.createGain();
        g.gain.value = c.gain * 0.5 * p;

        if (ctx.createStereoPanner) {
          var pan = ctx.createStereoPanner();
          pan.pan.value = c.pan;
          src.connect(g); g.connect(pan); pan.connect(self.master);
        } else {
          src.connect(g); g.connect(self.master);
        }
        src.start(t + c.delay);
      });

      // 笑到一半被掐断：跟合成版一样的手感
      var mg = this.master.gain;
      var cutT = t + 1.15;
      mg.setValueAtTime(0.42, cutT);
      mg.linearRampToValueAtTime(0.0001, cutT + 0.04);
      mg.setValueAtTime(0.0001, cutT + 0.11);
      mg.linearRampToValueAtTime(0.42, cutT + 0.55);
    },

    /* 耳语：不是说话，是"有人在你耳边呼吸着说话" */
    whisper: function (dur) {
      var ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      dur = dur || 3.0;
      var t = ctx.currentTime;

      var src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;

      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 4;

      var bp2 = ctx.createBiquadFilter();
      bp2.type = 'peaking';
      bp2.frequency.value = 2800;
      bp2.gain.value = 9;

      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.7);
      g.gain.setValueAtTime(0.055, t + dur - 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      // 4.6Hz 的音节断续：听起来像在说话，但一个字也听不清
      var lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 4.6;
      var lfoG = ctx.createGain();
      lfoG.gain.value = 0.042;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);

      var tail = g;
      if (ctx.createStereoPanner) {
        var pan = ctx.createStereoPanner();
        var plfo = ctx.createOscillator();
        plfo.frequency.value = 0.13;
        var plg = ctx.createGain();
        plg.gain.value = 0.85;
        plfo.connect(plg);
        plg.connect(pan.pan);
        plfo.start(t); plfo.stop(t + dur);
        g.connect(pan);
        tail = pan;
      }
      tail.connect(this.master);

      src.connect(bp); bp.connect(bp2); bp2.connect(g);
      src.start(t); src.stop(t + dur);
      lfo.start(t); lfo.stop(t + dur);
    }
  };

  /* ---------------- 撕裂条 ---------------- */
  function buildSlices() {
    var W = puppet.clientWidth, H = puppet.clientHeight;
    slices.innerHTML = '';
    for (var i = 0; i < 2; i++) {
      var top = Math.random() * 92;
      var h = 3 + Math.random() * 7;
      var d = document.createElement('div');
      d.className = 'slice';
      d.style.top = top + '%';
      d.style.height = h + '%';
      d.style.transform = 'translateX(' + (Math.random() * 16 - 8).toFixed(1) + '%)';
      d.style.backgroundSize = W + 'px ' + H + 'px';
      d.style.backgroundPosition = '0px ' + (-top / 100 * H).toFixed(0) + 'px';
      slices.appendChild(d);
    }
  }

  function blackFrame() {
    flash.style.transition = 'none';
    flash.style.background = '#000';
    flash.style.opacity = '1';
    return raf2();
  }

  /* 静默期的心跳：全黑里唯一还在动的东西。
     Android 有 navigator.vibrate，iOS Safari 不支持 —— 不支持就静默跳过，不能报错。 */
  function heartVibe(times) {
    if (!navigator.vibrate) return;
    var i = 0;
    function beat() {
      if (i++ >= times || R.dead) return;
      try { navigator.vibrate([20]); } catch (e) { /* ignore */ }
      later(beat, 1150);
    }
    later(beat, 250);
  }

  function vibrate(power) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate([0, 70, 40, 130, 30, 60].map(function (v) {
          return v ? Math.round(v * (power || 1)) : v;
        }));
      } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- 核心：惊吓 ---------------- */
  function scare(opt) {
    if (R.busy || R.dead) return Promise.resolve();
    opt = opt || {};
    var from = opt.from || 'center';
    var power = opt.power || 1;
    var hold = opt.hold || 470;
    var useFX = !!(window.FX && window.FX.ok);

    R.busy = true;
    document.body.classList.add('hit');
    puppet.style.transition = '';
    puppet.classList.remove('retreat', 'hit');

    // 归位到看不到的地方
    var offX = from === 'left' ? '-48%' : (from === 'right' ? '48%' : '0%');
    setFace({ s: 1.04, tx: offX, ty: '0px', rot: '0deg', o: 0, br: 0.18 });

    return blackFrame().then(function () {
      // 声音比画面早 140ms 起振。
      // 依据：听觉刺激到脑 8~10ms、视觉 20~40ms，加上解码与渲染延迟，
      // 140ms 能让身体先惊、眼睛后到 —— 这一下最难防。
      audio.revive(0.58, 0.015);   // 从"抽空"状态瞬间回血，否则尖叫的起音被压掉
      audio.scare(power);
      audio.playLaugh(power);
      return wait(140);
    }).then(function () {
      var target = 1.62 * power;
      var fxOn = false;
      if (useFX) fxOn = FX.start({ zoom: 1.0 + (power - 1) * 0.55 }) !== false;
      if (fxOn) FX.madness({ spin: true, total: (hold + 320) / 1000 });

      // 爆：几乎在同一帧内推满（WebGL 接管时 CSS 层让位）
      puppet.classList.add('hit');
      void puppet.offsetWidth;
      setFace({
        s: target.toFixed(3),
        tx: '0px',
        ty: '-1%',
        rot: (Math.random() * 5 - 2.5).toFixed(2) + 'deg',
        o: fxOn ? 0 : 1,
        br: 1.12,
        con: 1.18,
        sat: 1.0
      });
      // 洁净才有压迫感：撕裂条只在更狠的那几下出现
      if (power > 1.05) buildSlices();
      R.fxOn = fxOn;

      // 单帧反色：大脑还没反应过来，画面已经"错"了
      flash.classList.add('invert');
      later(function () {
        flash.classList.remove('invert');
        flash.style.transition = 'opacity .16s ease-out';
        flash.style.opacity = '0';
      }, 24);
      // 刻意不做整屏白闪：白闪会把脸洗成一片白，等于把惊吓洗掉

      blood.style.transition = 'none';
      blood.style.opacity = '0.34';
      later(function () {
        blood.style.transition = 'opacity .5s ease-out';
        blood.style.opacity = '0';
      }, 70);

      vibrate(power);

      return wait(hold);
    }).then(function () {
      // 黑一帧，藏住 WebGL 画面与 CSS 画面的接缝
      return R.fxOn ? blackFrame() : null;
    }).then(function () {
      if (R.fxOn) {
        FX.stop();
        flash.style.transition = 'opacity .22s ease-out';
        flash.style.opacity = '0';
      }
      // 骤降：不是"关掉"，是沉回黑暗里（观众会继续盯着找它）
      puppet.classList.remove('hit');
      puppet.classList.add('retreat');
      setFace({
        s: 1.36, tx: '0px', ty: '0px', rot: '0deg',
        o: 0.18, br: 0.5, con: 1.12, sat: 0.85
      });
      return wait(310);
    }).then(function () {
      puppet.classList.remove('retreat');
      audio.revive(0.42, 0.8);     // 回落到常态电平，不然下一段铺垫没有对比空间
      R.busy = false;
      R.started = true;
      document.body.classList.remove('hit');
    });
  }

  /* ---------------- 假警报：虚惊一场，为真冲击铺路 ----------------
     第一次"看起来要出事、结果没事"会让身体先进入戒备（心跳、呼吸变浅），
     这种生理唤醒会迁移到下一次 —— 所以第二次哪怕刺激更小，反应也更大。
     同时它会打掉"我摸清套路了"的自信。 */
  function falseAlarm(kind) {
    if (R.dead || R.busy) return;

    if (kind === 'peek') {
      // 只露半边、带一点拖影、65ms 就消失 —— 看见了，但说不清是什么。
      // 关键是"糊"和"偏"：清晰的整脸那是真惊吓，不是假警报
      audio.sting(0.28);
      puppet.classList.add('awake');
      puppet.classList.remove('retreat');
      // 保留对比度、降饱和、加模糊 —— 整串写全，否则会覆盖掉 #puppet 的 contrast/saturate
      puppet.style.filter = 'contrast(1.45) saturate(0.55) brightness(1.15) blur(1.8px)';
      setFace({ o: 0.52, br: 0.58, s: 1.55, tx: '-36%', ty: '-6%', rot: '-9deg' });
      later(function () {
        if (R.dead) return;
        puppet.style.filter = '';
        puppet.classList.add('retreat');
        setFace({ o: 0.15, br: 0.32, s: 1.18, tx: '0px', ty: '0px', rot: '0deg' });
      }, 65);
      return;
    }

    if (kind === 'freeze') {
      // 信号卡住：反色 30ms → 正常 15ms → 反色 25ms，总共约 70ms。
      // 比"闪一下"更像视频坏了 —— 人会先怀疑设备、再怀疑内容，那个空档最容易被打穿
      audio.sting(0.10);
      flash.classList.add('invert');
      later(function () { flash.classList.remove('invert'); }, 30);
      later(function () {
        flash.classList.add('invert');
        later(function () { flash.classList.remove('invert'); }, 25);
      }, 45);
      return;
    }

    // 灯闪：光有了，东西没有。最便宜的假警报
    audio.sting(0.15);
    flash.style.transition = 'opacity .045s linear';
    flash.style.opacity = '0.34';
    later(function () {
      flash.style.transition = 'opacity .3s ease-out';
      flash.style.opacity = '0';
    }, 75);
  }

  /* ---------------- 负空间：几乎全黑，只剩眼睛在反光 ----------------
     给出 30%，剩下的 70% 由他自己补。人自己想象出来的永远比画出来的狠。 */
  function darkEye() {
    if (R.dead) return;
    puppet.style.transition = 'transform 2.8s cubic-bezier(.4,.05,.5,1), opacity 1.6s ease, filter 1.6s ease';
    puppet.classList.add('awake');
    puppet.classList.remove('retreat');
    // 偏出画框一点，让一只眼被边缘切掉 —— 对称的一双眼像装饰，只剩一只才像"它在看"
    setFace({ o: 0.06, br: 0.035, s: 1.46, tx: '-11%', ty: '2%', rot: '-2deg', con: 1.22, sat: 0.68 });
  }

  /* ---------------- 猎捕模式：随机突袭 + 缓慢游移 ---------------- */
  /* ---------------- 导演系统 ----------------
     旧版的问题：猎捕期同时跑 4 个独立定时器（突脸 7.5~14.5s、假警报 3.2~5.8s、
     闪帧 1.6~4s、背景笑 4.2~9.4s），叠加后平均每 1~2 秒就有一个事件 —— 观感必然是"频闪"。
     机器越勤快，人越麻木：惊吓是消耗品，用一次敏感度就衰减一分。

     改成 Left 4 Dead 的四阶段循环。核心不是"更多惊吓"，而是"更长��空白 + 更大的落差"：
       RELAX  12~22s   什么都不发生（真的什么都不做，这是最难做到也最有效的一步）
       BUILD  11~16s   四层逐级加码：低频 → 闪帧 → 假警报 → 抽空
       SPIKE  1 次     在最安静的瞬间爆，不是在最吵的时候
       FADE   3~5s     只留余韵
     强度随循环递增，频率随循环递减 —— 越往后越稀、越狠。 */

  var DIR = { cyc: 0, phase: 'idle' };

  function director() {
    if (R.dead || !R.hunt) return;
    DIR.cyc++;
    DIR.phase = 'relax';
    var lvl = Math.min(1, (DIR.cyc - 1) / 4);

    // 越轨：每 4 个循环来一次"不按套路"。
    // 到第 4 轮时，观众已经摸清"静默 → 积累 → 爆"的节律，大脑开始提前准备；
    // 那就在静默的第 3 秒直接爆，零铺垫 —— 这一次才是真正吓到人的那一次。
    if (DIR.cyc % 4 === 0) {
      later(function () {
        if (R.dead || R.busy) return;
        spike(1.0);
      }, 2400 + Math.random() * 2400);
      return;
    }

    // 第一次进猎捕时刚被最狠的一下炸过，先给个短缓冲；
    // 之后是真正的长静默，而且越往后越长
    // 每 3 个循环来一次"超长静默"：25~40 秒什么都不发生。
    // 观众会以为体验结束了，然后它才动 —— 落差全在这里
    var rest;
    if (DIR.cyc === 1) rest = 5200;
    else if (DIR.cyc % 3 === 0) rest = 25000 + Math.random() * 15000;
    else rest = 12000 + lvl * 8000 + Math.random() * 5000;

    later(function () {
      if (R.dead || !R.hunt) return;
      buildUp(lvl);
    }, rest);
  }

  function buildUp(lvl) {
    DIR.phase = 'build';
    var total = 11000 + Math.random() * 5000;

    // 底层：低频缓慢加深，观众察觉不到，但身体会先反应
    audio.droneRamp(0.26 + lvl * 0.26, total / 1000);

    // 1/4 处：一次闪帧。整段 BUILD 只此一次 —— 不连闪是"不频闪"的关键
    later(function () {
      if (R.dead || R.busy) return;
      if (Math.random() < 0.55 && window.FX && FX.ok) FX.flashFrames(60);
      else { puppet.classList.add('awake'); drift(); }
    }, total * 0.26);

    // 1/2 处：假警报。三种轮着来，不让观众摸到同一种
    later(function () {
      if (R.dead || R.busy) return;
      falseAlarm(['peek', 'freeze', 'light'][DIR.cyc % 3]);
    }, total * 0.52);

    // 3/4 处：抽空。落差的全部重量都压在这之后的 2.5 秒里
    later(function () {
      if (R.dead) return;
      audio.suck();
      heartVibe(2);
    }, total * 0.78);

    // 峰值：在最安静的那一刻爆
    later(function () {
      if (R.dead) return;
      spike(lvl);
    }, total + 2500);
  }

  function spike(lvl) {
    DIR.phase = 'spike';
    var pool = ['center', 'left', 'right', 'center', 'left'];
    scare({
      from: pool[Math.floor(Math.random() * pool.length)],
      power: 1.0 + lvl * 0.44,
      hold: 430 + lvl * 230
    }).then(function () {
      if (R.dead) return;
      DIR.phase = 'fade';
      later(function () {
        if (R.dead || !R.hunt) return;
        audio.pulseAmbient(0.016 + lvl * 0.022);
        director();
      }, 3400 + Math.random() * 1800);
    });
  }

  /* 静默期的"它在动"：只改位置、不制造声音，不算惊吓，但让人不敢移开视线 */
  function idleDrift() {
    if (R.dead || !R.hunt) return;
    if (!R.busy && (DIR.phase === 'relax' || (DIR.phase === 'build' && Math.random() < 0.45))) {
      puppet.classList.add('awake');
      drift();
    }
    // 间隔用幂律而不是均匀分布：均匀随机会让间隔全部挤在平均值附近，
    // 5.3、5.3、5.5、5.4 —— 这种"太均匀"本身就是规律。偶尔来一次 16~26 秒的超长静默，
    // 让观众以为结束了，那才是落差。
    var r = Math.random(), gap;
    if (r < 0.72) gap = 3200 + Math.random() * 3000;
    else if (r < 0.94) gap = 7000 + Math.random() * 6000;
    else gap = 16000 + Math.random() * 10000;
    later(idleDrift, gap);
  }

  function drift() {
    if (!R.hunt || R.busy || R.dead) return;
    var x = (Math.random() * 2 - 1) * 5;
    var y = (Math.random() * 2 - 1) * 3.5;
    var s = 1.09 + Math.random() * 0.07;
    puppet.style.transition =
      'transform 3.2s cubic-bezier(.4,0,.6,1), opacity 2.4s ease, filter 2.4s ease';
    setFace({
      tx: x.toFixed(1) + '%',
      ty: y.toFixed(1) + '%',
      s: s.toFixed(3),
      o: (0.18 + Math.random() * 0.08).toFixed(3),
      br: (0.48 + Math.random() * 0.1).toFixed(2)
    });
    later(function () {
      puppet.style.transition = '';
      if (!R.busy) puppet.classList.add('awake');
    }, 20);
    // 不再自己递归：之前每 1.4~3.4 秒重跑一次、每次都在改明暗，
    // 叠加眼睛层的正弦呼吸，观感就是"有规律的频闪"。节奏统一交给 idleDrift。
  }

  function scheduleHunt() {
    if (R.dead) return;
    later(function () {
      if (R.dead || R.busy) { scheduleHunt(); return; }
      var pool = ['center', 'left', 'right', 'center'];
      var from = pool[Math.floor(Math.random() * pool.length)];
      scare({
        from: from,
        power: 0.96 + Math.random() * 0.16,
        hold: 380 + Math.random() * 240
      }).then(function () {
        if (R.dead) return;
        puppet.classList.add('awake');
        drift();
        scheduleHunt();
      });
    }, 7500 + Math.random() * 7000);   // 7.5~14.5 秒一次。太密会脱敏，第三次就变成笑点
  }

  /* ---------------- 它知道你是谁 ---------------- */
  function knowYou() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    knowEl.querySelector('.k1').textContent =
      (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日　' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    knowEl.querySelector('.k2').textContent =
      SEEN > 0 ? comebackLine() : '第一次';
    knowEl.querySelector('.k3').textContent = '你一个人在看。';

    knowEl.classList.add('on');
    audio.whisper(4.4);
    later(function () { knowEl.querySelector('.k1').classList.add('show'); }, 120);
    later(function () { knowEl.querySelector('.k2').classList.add('show'); }, 820);
    later(function () { knowEl.querySelector('.k3').classList.add('show'); }, 1500);
  }

  function endKnow() {
    knowEl.classList.remove('on');
    var ps = knowEl.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) ps[i].classList.remove('show');
  }

  /* ---------------- 眼睛特写：先看见眼睛，再看见脸 ---------------- */
  function eyeCut(ms) {
    ms = ms || 1500;
    return new Promise(function (res) {
      // 优先走 WebGL：把平面的眼睛当球转，才有 3D 感
      if (window.FX && window.FX.ok && window.FX.eyeStart && window.FX.eyeStart(ms)) {
        audio.whisper(0.5);
        later(function () {
          window.FX.eyeStop();
          later(res, 70);
        }, ms + 20);
        return;
      }
      // WebGL 不可用时退回 CSS 层
      if (!eyeShot) { res(); return; }
      eyeShot.classList.remove('on');
      void eyeShot.offsetWidth;
      eyeShot.classList.add('on');
      audio.whisper(0.5);
      later(function () {
        eyeShot.classList.remove('on');
        later(res, 60);
      }, ms);
    });
  }

  /* ---------------- 假崩溃：让它以为页面坏了 ---------------- */
  var CRASH_LINES = [
    '> renderer process lost',
    '> pid 4981 terminated',
    '> 0x0000 0x000F 0xDEAD 0x0000',
    '> frame buffer: corrupted',
    '> attempting recovery ....',
    '> recovery failed'
  ];

  function crashOut() {
    crashEl.classList.add('on');
    crashEl.classList.remove('phase2');
    document.body.classList.add('crashing');
    crashLog.textContent = '';
    audio.whisper(2.2);

    var i = 0;
    function tick() {
      if (i >= CRASH_LINES.length) return;
      crashLog.textContent += CRASH_LINES[i] + "\n";
      i++;
      later(tick, 80 + Math.random() * 110);
    }
    tick();

    // 1.5 秒后翻脸：变成浏览器自己的崩溃页 —— 这一下最骗人
    later(function () {
      crashEl.classList.add('phase2');
      document.body.classList.remove('crashing');
    }, 1150);
  }

  function endCrash() {
    crashEl.classList.remove('on');
    crashEl.classList.remove('phase2');
    document.body.classList.remove('crashing');
    crashLog.textContent = '';
  }

  /* ---------------- 背景笑声的起伏 ---------------- */
  function scheduleAmbient() {
    if (R.dead) return;
    later(function () {
      if (R.dead) return;
      if (R.hunt && !R.busy) audio.pulseAmbient(0.012 + Math.random() * 0.035);
      scheduleAmbient();
    }, 4200 + Math.random() * 5200);
  }

  /* ---------------- 闪帧：人在暗处，忽然闪一下 ---------------- */
  /* 猎捕期的"虚惊"：真突脸之间用假警报填空，既维持紧张又不把观众的钝化阈值打穿 */
  function scheduleFeint() {
    if (R.dead) return;
    later(function () {
      if (R.dead) return;
      if (R.hunt && !R.busy) falseAlarm(Math.random() < 0.42 ? 'peek' : 'light');
      scheduleFeint();
    }, 3200 + Math.random() * 2600);
  }

  function scheduleFlash() {
    if (R.dead) return;
    later(function () {
      if (R.dead) return;
      if (R.hunt && !R.busy) {
        if (Math.random() < 0.45 && eyeShot) {
          eyeShot.classList.add('on');          // 90ms 的一双眼睛
          eyeShot.style.transition = 'none';
          later(function () {
            eyeShot.classList.remove('on');
            eyeShot.style.transition = '';
          }, 90);
        } else if (window.FX && FX.ok) {
          FX.flashFrames(70);
        }
      }
      scheduleFlash();
    }, 1600 + Math.random() * 2400);
  }

  /* ---------------- 颗粒 ---------------- */
  var gctx = grain.getContext('2d');
  var gw = 100, gh = 180;

  function sizeGrain() {
    gw = 240;
    gh = Math.max(260, Math.round(240 * (window.innerHeight / window.innerWidth)));
    grain.width = gw;
    grain.height = gh;
  }

  function drawGrain() {
    var img = gctx.createImageData(gw, gh);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = (Math.random() * 255) | 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
  }

  /* ---------------- 性能保护：撑不住就自己减效果 ---------------- */
  var perf = { n: 0, t0: 0, slow: 0, off: false };

  function watchPerf(now) {
    if (perf.off) return;
    if (location.search.indexOf('noperf=1') >= 0) return;
    if (!perf.t0) { perf.t0 = now; return; }
    perf.n++;
    if (now - perf.t0 < 1500) return;

    var fps = perf.n * 1000 / (now - perf.t0);
    if (fps < 24) perf.slow++;
    else perf.slow = Math.max(0, perf.slow - 1);

    if (perf.slow >= 2) {
      perf.off = true;
      document.body.classList.add('lowpower');
      if (window.FX && window.FX.ok) window.FX.disable();
    }
    perf.n = 0;
    perf.t0 = now;
  }

  /* ---------------- 主循环 ---------------- */
  var lastGrain = 0;
  var lastEye = 0;
  var eyeLayer = document.querySelector('.layer.eyes');

  function loop(now) {
    requestAnimationFrame(loop);
    watchPerf(now);
    // 突脸期间不画颗粒（WebGL 那边已经在烧 GPU 了）
    if (!R.busy && now - lastGrain > 68) {
      drawGrain();
      lastGrain = now;
    }
    R.tension *= 0.9965;

    // 尖叫越大声，脸扭得越狠
    if (R.busy && window.FX && window.FX.ok) {
      FX.audio(audio.energy());
    }

    // 眼睛的呼吸：8Hz 更新，别用 CSS 动画（混合层每帧重算太贵）
    if (eyeLayer && !R.hit && now - lastEye > 120) {
      lastEye = now;
      var base = puppet.classList.contains('awake') ? 0.62 : 0.34;
      // 原来是 sin(now/820) 的连续呼吸 —— 正弦是最规律的波形，周期 5.15 秒，
      // 一眼就能看出节律，这就是"频闪感"的一半来源。
      // 改成：随机间隔的突发亮一下，间隔 2.5~7 秒，衰减无周期，另加一点微抖。
      if (now > (R.eyeNext || 0)) {
        R.eyeNext = now + 2500 + Math.random() * 4500;
        R.eyeBurst = 1.0;
      }
      R.eyeBurst = (R.eyeBurst || 0) * 0.976;
      var v = base * (0.70 + 0.52 * R.eyeBurst) + (Math.random() - 0.5) * 0.05;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      eyeLayer.style.opacity = v.toFixed(2);
    }

    if (!R.busy) {
      var px = 0, py = 0;
      if (R.tilt.on) {
        px = Math.max(-14, Math.min(14, R.tilt.g * 0.5));
        py = Math.max(-12, Math.min(12, (R.tilt.b - 40) * 0.35));
      } else {
        px = (R.pointer.x - 0.5) * -18;
        py = (R.pointer.y - 0.5) * -14;
      }
      parallax.style.setProperty('--px', px.toFixed(2) + 'px');
      parallax.style.setProperty('--py', py.toFixed(2) + 'px');
    }
  }

  /* ---------------- 输入 ---------------- */
  var lastPt = { x: 0, y: 0, t: 0 };
  var lastSwing = 0;

  function onMove(e) {
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    if (typeof t.clientX !== 'number') return;
    R.pointer.x = t.clientX / window.innerWidth;
    R.pointer.y = t.clientY / window.innerHeight;
    R.tension = Math.min(1, R.tension + 0.035);

    // 桌面端没有"甩手机"，那就用"鼠标猛甩"顶替
    var now = performance.now();
    if (lastPt.t && now - lastPt.t < 140) {
      var d = Math.hypot(t.clientX - lastPt.x, t.clientY - lastPt.y);
      var v = d / (now - lastPt.t);            // px / ms
      if (v > 2.3 && now - lastSwing > 2600 && !R.busy && !R.dead) {
        lastSwing = now;
        scare({ from: Math.random() > 0.5 ? 'left' : 'right', power: 1.06, hold: 520 });
      }
    }
    lastPt.x = t.clientX;
    lastPt.y = t.clientY;
    lastPt.t = now;
  }

  var touched = false;
  function onTouch(e) {
    if (e && e.target && e.target.closest && e.target.closest('#exit, #end, #again')) return;
    audio.unlock();
    if (touched || R.dead) return;
    touched = true;
    // 你一动，它就来了
    later(function () {
      scare({ from: 'center', power: 1.03, hold: 540 });
    }, 70);
  }

  var lastAcc = { x: 0, y: 0, z: 0 }, accInit = false;

  function onMotion(e) {
    var a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    if (!accInit) { lastAcc = { x: a.x, y: a.y, z: a.z }; accInit = true; return; }
    var j = Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z);
    lastAcc = { x: a.x, y: a.y, z: a.z };
    if (j > 30) {
      audio.unlock();
      if (!R.dead && !R.busy) scare({ from: Math.random() > 0.5 ? 'left' : 'right', power: 1.08, hold: 520 });
    }
  }

  function onOrient(e) {
    R.tilt.on = true;
    R.tilt.g = e.gamma || 0;
    R.tilt.b = e.beta || 0;
  }

  /* ---------------- 结束 / 重启 ---------------- */
  var taps = 0, tapTimer = null;

  function finish() {
    if (R.dead) return;
    R.dead = true;
    clearAll();
    if (typeof audio !== 'undefined') audio.stopAmbient();
    if (eyeShot) eyeShot.classList.remove('on');
    if (knowEl) knowEl.classList.remove('on');
    if (crashEl) {
      crashEl.classList.remove('on');
      document.body.classList.remove('crashing');
    }
    blood.style.transition = 'opacity 1.4s ease';
    blood.style.opacity = '0';
    puppet.style.transition = 'opacity 1.6s ease';
    setFace({ o: 0 });
    setTimeout(function () {
      var l2 = endEl.querySelector('.l2');
      if (l2) {
        l2.textContent = SEEN > 0 ? comebackLine() : '你已经回头了';
      }
      endEl.classList.add('on');
      if (audio.ctx && audio.ctx.state === 'running') {
        audio.ctx.suspend();
      }
    }, 500);
  }

  exitBtn.addEventListener('click', function () {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { taps = 0; }, 1800);
    if (taps >= 3) finish();
  });

  againBtn.addEventListener('click', function () {
    location.reload();
  });

  /* ---------------- 开场时间轴 ---------------- */
  function boot() {
    sizeGrain();
    requestAnimationFrame(loop);
    audio.unlock();

    // ?manual=1：只初始化不自动演出，供自动化测试单独驱动
    if (location.search.indexOf('manual=1') >= 0) {
      if (window.FX && window.FX.ok) FX.init();
      return;
    }

    if (window.FX && window.FX.ok) later(function () { FX.init(); }, 700);

    // 它记得你来过几次：第二次之后，不再给你准备的时间
    var fast = SEEN > 0;
    // 铺垫时间轴（单位 ms）
    // 相比旧版：第一次突脸从 3.4s 推到 14.3s；抽空后静默 3.3s 才炸；
    // 中间插两次假警报 + 一段负空间；低频在 20 秒里缓慢加深
    // 开场改成"一段普通的家用录像"，所以时间轴按秒级走，不再有暗调铺垫
    var T = fast
      ? { tapeOn: 60, roomIn: 320, stall1: 2100, something: 2650, stall2: 4200,
          suck: 5300, scare1: 6250, pre2: 7000, gap2: 780,
          know: 8500, crash: 10900, final: 13300, hunt: 15500 }
      : { tapeOn: 220, roomIn: 750, stall1: 4300, something: 5300, stall2: 8300,
          suck: 10100, scare1: 11400, pre2: 12500, gap2: 1300,
          know: 14900, crash: 18300, final: 21900, hunt: 25200 };

    /* ---------- 开场：伪装成一段普通的家用录像 ----------
       旧版一上来就是暗调小丑 + 诱导点，观众一眼就知道"这是恐怖页面"，防备全开。
       现在先给 6~8 秒完全正常的东西：明亮的客厅、空调声、走秒的时间戳。
       他会以为在看一段跟自己无关的录像 —— 那时候防备是最低的。 */

    later(function () { if (tape) tape.classList.add('on'); }, T.tapeOn);

    // 时间戳开始走秒，让它"像真的在录"
    later(function () {
      var tcEl = tape ? tape.querySelector('.tape-tc') : null;
      if (!tcEl) return;
      var sec = 7;
      setInterval(function () {
        sec++;
        var mm = 32 + Math.floor(sec / 60), ss = sec % 60;
        tcEl.textContent = '2026-11-01 14:' + (mm < 10 ? '0' + mm : mm) + ':' + (ss < 10 ? '0' + ss : ss);
      }, 1000);
    }, T.tapeOn + 500);

    // 室内空调的低频嗡鸣。有声音才像"真的在放视频"，而且这个声音不带任何威胁
    later(function () { audio.room(); }, T.roomIn);

    // ---- 第一次卡顿：110ms。人的第一反应是"我网卡了"，而不是"这有鬼" ----
    later(function () {
      if (!tape) return;
      tape.classList.add('stall');
      later(function () {
        tape.classList.remove('stall');
        tape.classList.add('recovering');            // 恢复后的残留：比正常暗一点点
        later(function () { tape.classList.remove('recovering'); }, 1100);
      }, 110);
    }, T.stall1);

    // 恢复之后，画面右侧的阴影里多了一点东西。不盯着看根本发现不了
    later(function () { if (tape) tape.classList.add('something'); }, T.something);

    // ---- 第二次卡顿：340ms，更久、更明显 ----
    later(function () {
      if (!tape) return;
      tape.classList.add('stall2');
      audio.droneRamp(0.20, 3);        // 这时候才悄悄把低频拉起来一点
      later(function () {
        tape.classList.remove('stall2');
        tape.classList.add('something2');   // 恢复时那个东西已经更清楚了
        tape.classList.add('recovering');
        later(function () { tape.classList.remove('recovering'); }, 1300);
      }, 340);
    }, T.stall2);

    // 抽空：突然的、彻底的安静。房间声被掐断的那一下比尖叫更吓人
    later(function () {
      audio.suck();
      audio.roomOff();
      heartVibe(2);
    }, T.suck);

    // 第一次
    later(function () {
      if (R.started) return;
      if (tape) tape.classList.remove('on');   // 录像消失，由小丑接管这一帧
      puppet.style.transition = '';
      scare({ from: 'center', power: fast ? 1.12 : 1.0, hold: fast ? 620 : 500 });
    }, T.scare1);

    // 第二次：从画面边缘横切进来（利用边缘视觉）
    later(function () {
      if (R.dead) return;
      puppet.style.transition = '';
      puppet.classList.add('awake');
      setFace({ o: 0.25, br: 0.52, s: 1.1, tx: '0px', ty: '0px' });
      // 卡帧假警报：先让信号"坏"一下，再真的从右边切进来
      later(function () {
        if (R.dead || R.busy) return;
        falseAlarm('freeze');
      }, T.gap2 - 420);
      later(function () {
        if (R.dead) return;
        scare({ from: 'right', power: 1.08, hold: 540 });
      }, T.gap2);
    }, T.pre2);

    // 它知道你是谁、几点、第几次
    later(function () {
      if (R.dead) return;
      knowYou();
    }, T.know);

    later(function () {
      endKnow();
    }, T.know + 2600);

    // 假装坏了（这一段最贵：观众以为网站在崩溃，防备会完全放下）
    later(function () {
      if (R.dead) return;
      crashOut();
    }, T.crash);

    later(function () {
      endCrash();
    }, T.crash + 3200);

    // 最后一次，最狠的一次
    later(function () {
      if (R.dead) return;
      // 先让那双眼睛占满屏幕 0.46 秒 —— 你以为看清它了，然后才发现只是眼睛
      eyeCut(1500).then(function () {
        if (R.dead) return;
        scare({ from: 'center', power: 1.32, hold: 700 });
      });
    }, T.final);

    // 进入猎捕模式
    later(function () {
      if (R.dead) return;
      R.hunt = true;
      puppet.classList.add('awake');
      puppet.style.transition = '';
      drift();
      audio.startAmbientLaugh();
      director();        // 单一状态机接管后续一切节奏
      idleDrift();
    }, T.hunt);
  }

  /* ---------------- 事件绑定 ---------------- */
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('pointerdown', onTouch, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') finish();
  });
  window.addEventListener('devicemotion', onMotion, { passive: true });
  window.addEventListener('deviceorientation', onOrient, { passive: true });
  window.addEventListener('orientationchange', sizeGrain);

  /* 不等 window.load：图片加载最多等 2.5 秒，剩下的交给黑屏兜着 */
  function whenImagesReady(fn) {
    var imgs = Array.prototype.slice.call(document.images);
    var left = imgs.length, fired = false;
    function go() { if (fired) return; fired = true; fn(); }
    function tick() { left--; if (left <= 0) go(); }
    if (!imgs.length) return go();
    imgs.forEach(function (img) {
      if (img.complete) tick();
      else {
        img.addEventListener('load', tick);
        img.addEventListener('error', tick);
      }
    });
    later(go, 1400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { whenImagesReady(boot); });
  } else {
    whenImagesReady(boot);
  }
})();
