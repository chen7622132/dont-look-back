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
    for (var k in o) puppet.style.setProperty('--' + k, o[k]);
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
      dg.gain.value = 0.16;
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
      g.exponentialRampToValueAtTime(0.42, ctx.currentTime + 4.5);
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
      out.connect(this.master);

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

    R.busy = true;
    document.body.classList.add('hit');
    puppet.style.transition = '';
    puppet.classList.remove('retreat', 'hit');

    // 归位到看不到的地方
    var offX = from === 'left' ? '-48%' : (from === 'right' ? '48%' : '0%');
    setFace({ s: 1.04, tx: offX, ty: '0px', rot: '0deg', o: 0, br: 0.18 });

    return blackFrame().then(function () {
      // 爆：几乎在同一帧内推满
      puppet.classList.add('hit');
      void puppet.offsetWidth;
      setFace({
        s: (1.62 * power).toFixed(3),
        tx: '0px',
        ty: '-1%',
        rot: (Math.random() * 5 - 2.5).toFixed(2) + 'deg',
        o: 1,
        br: 1.12,
        con: 1.18,
        sat: 1.0
      });
      // 洁净才有压迫感：撕裂条只在更狠的那几下出现，第一次保持干净
      if (power > 1.05) buildSlices();

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

      audio.scare(power);
      vibrate(power);

      return wait(hold);
    }).then(function () {
      // 骤降：不是"关掉"，是沉回黑暗里（观众会继续盯着找它）
      puppet.classList.remove('hit');
      puppet.classList.add('retreat');
      setFace({
        s: 1.36, tx: '0px', ty: '0px', rot: '0deg',
        o: 0.18, br: 0.5, con: 1.12, sat: 0.85
      });
      return wait(300);
    }).then(function () {
      puppet.classList.remove('retreat');
      R.busy = false;
      R.started = true;
      document.body.classList.remove('hit');
    });
  }

  /* ---------------- 猎捕模式：随机突袭 + 缓慢游移 ---------------- */
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
    later(drift, 2800 + Math.random() * 3800);
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
    }, 6500 + Math.random() * 10500);
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

  /* ---------------- 主循环 ---------------- */
  var lastGrain = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (now - lastGrain > 52) {
      drawGrain();
      lastGrain = now;
    }
    R.tension *= 0.9965;

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
  function onMove(e) {
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    if (typeof t.clientX !== 'number') return;
    R.pointer.x = t.clientX / window.innerWidth;
    R.pointer.y = t.clientY / window.innerHeight;
    R.tension = Math.min(1, R.tension + 0.035);
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
    blood.style.transition = 'opacity 1.4s ease';
    blood.style.opacity = '0';
    puppet.style.transition = 'opacity 1.6s ease';
    setFace({ o: 0 });
    setTimeout(function () {
      var l2 = endEl.querySelector('.l2');
      if (l2) {
        l2.textContent = SEEN > 0
          ? '第 ' + (SEEN + 1) + ' 次了，你还是回来了'
          : '你已经回头了';
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

    // 它记得你来过几次：第二次之后，不再给你准备的时间
    var fast = SEEN > 0;
    var T = fast
      ? { dotOn: 100, dotOff: 820, emerge: 420, awake: 820, push: 1150, cut: 1700,
          scare1: 2050, pre2: 3200, gap2: 1050, hunt: 5200 }
      : { dotOn: 300, dotOff: 1480, emerge: 1350, awake: 1950, push: 2750, cut: 3700,
          scare1: 4100, pre2: 5300, gap2: 1600, hunt: 8000 };

    // 引诱点：不是为了让你点，是为了让你凑近
    later(function () { dot.classList.add('on'); }, T.dotOn);
    later(function () { dot.classList.remove('on'); }, T.dotOff);

    // 它已经在那儿了，只是太暗 —— 然后极慢地靠近
    later(function () {
      puppet.style.transition = (fast ? 'transform 1.1s' : 'transform 1.9s') +
        ' cubic-bezier(.3,.05,.4,1), opacity ' + (fast ? '1.1s' : '1.9s') +
        ' ease, filter ' + (fast ? '1.1s' : '1.9s') + ' ease';
      setFace({ o: 0.24, s: 1.07, br: 0.5, con: 1.1, sat: 0.8 });
    }, T.emerge);

    // 眼睛先醒过来
    later(function () {
      puppet.classList.add('awake');
    }, T.awake);

    // 它已经近到能看清了，可你还是没动
    later(function () {
      puppet.style.transition = 'transform 2.6s cubic-bezier(.35,.05,.45,1), opacity 1.6s ease, filter 1.6s ease';
      setFace({ o: 0.3, s: 1.2, br: 0.6 });
    }, T.push);

    // 抽走一切（静默剥夺）
    later(function () {
      puppet.classList.remove('awake');
      puppet.style.transition = 'transform .45s ease, opacity .3s ease, filter .45s ease';
      setFace({ o: 0.02, br: 0.12, s: 1.17 });
    }, T.cut);

    // 第一次
    later(function () {
      if (R.started) return;
      puppet.style.transition = '';
      scare({ from: 'center', power: fast ? 1.12 : 1.0, hold: fast ? 620 : 500 });
    }, T.scare1);

    // 第二次：从画面边缘横切进来（利用边缘视觉）
    later(function () {
      if (R.dead) return;
      puppet.style.transition = '';
      puppet.classList.add('awake');
      setFace({ o: 0.25, br: 0.52, s: 1.1, tx: '0px', ty: '0px' });
      later(function () {
        if (R.dead) return;
        scare({ from: 'right', power: 1.08, hold: 540 });
      }, T.gap2);
    }, T.pre2);

    // 进入猎捕模式
    later(function () {
      if (R.dead) return;
      R.hunt = true;
      puppet.classList.add('awake');
      puppet.style.transition = '';
      drift();
      scheduleHunt();
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
    later(go, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { whenImagesReady(boot); });
  } else {
    whenImagesReady(boot);
  }
})();
