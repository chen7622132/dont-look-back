/* ============================================================
   fx.js — WebGL 全屏后处理
   把那张脸当纹理折腾：液化 / 万花筒 / 色差 / 撕裂 / 音频驱动
   WebGL 不可用时返回 null，调用方自动降级到纯 CSS 版本
   ============================================================ */
window.FX = (function () {
  'use strict';

  var canvas = document.getElementById('fx');
  if (!canvas) return null;
  // ?nofx=1 强制关闭，用于只测 CSS 版时序
  if (location.search.indexOf('nofx=1') >= 0) return null;

  var gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  }) || canvas.getContext('experimental-webgl');

  if (!gl) return null;

  var VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform float uTime;',
    'uniform float uWarp;',      // 液化强度
    'uniform float uRGB;',       // 色差
    'uniform float uKaleido;',   // 万花筒段数（<1 关闭）
    'uniform float uZoom;',      // 缩放
    'uniform float uFlash;',     // 曝光
    'uniform float uGrain;',     // 颗粒
    'uniform float uTear;',      // 横向撕裂
    'uniform float uAudio;',     // 音频能量 0..1
    'uniform vec2  uPan;',       // 画面偏移
    'uniform vec2  uRes;',
    'uniform vec2  uCover;',

    'float hash(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',

    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i), b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',

    'void main(){',
    '  float aspect = uRes.x / uRes.y;',
    '  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uPan;',

    // 对称化：把左半张脸镜像到右半。
    // 万花筒会把任何照片都搅成花瓣，而"完美对称的人脸"才是真正的恐怖谷
    '  if (uKaleido > 0.01) {',
    '    float mx = (uv.x > 0.5) ? (1.0 - uv.x) : uv.x;',
    '    uv.x = mix(uv.x, mx, uKaleido);',
    '  }',

    // 等比例裁切（模拟 object-fit: cover），否则脸会被横向压扁
    '  uv = (uv - 0.5) * uCover + 0.5;',

    // 液化：一层噪声推 UV（只算一次，省一半采样）
    '  float t = uTime;',
    '  float amp = uWarp * (0.6 + uAudio * 0.5);',
    '  vec2 w1 = vec2(noise(uv * 5.0 + vec2(t * 0.8, -t * 0.6)),',
    '                 noise(uv * 5.0 + vec2(-t * 0.5, t * 0.9) + 17.0)) - 0.5;',
    '  uv += w1 * amp;',

    // 横向撕裂：按行跳
    '  float row = floor(uv.y * 38.0);',
    '  float seed = floor(t * 2.0);',
    '  if (hash(vec2(row, seed)) > 0.82) {',
    '    uv.x += (hash(vec2(row, seed + 3.0)) - 0.5) * 0.32 * uTear;',
    '    uv.y += (hash(vec2(row + 7.0, seed)) - 0.5) * 0.012 * uTear;',
    '  }',

    // 抽搐：整张脸按 24Hz 跳小步，像神经出了问题
    '  float jt = floor(t * 24.0);',
    '  uv += vec2(hash(vec2(jt, 7.0)) - 0.5, hash(vec2(jt, 19.0)) - 0.5) * 0.02 * uTear;',

    // 甩头：整张脸左右小幅摆动
    '  float ang = sin(t * 13.0) * 0.028 * uTear;',
    '  vec2 cc = uv - 0.5;',
    '  float ca = cos(ang), sa = sin(ang);',
    '  uv = vec2(ca * cc.x - sa * cc.y, sa * cc.x + ca * cc.y) + 0.5;',

    // 色差
    '  float ch = uRGB * (1.0 + uAudio * 1.2);',
    '  float r = texture2D(uTex, uv + vec2(ch, 0.0)).r;',
    '  float g = texture2D(uTex, uv).g;',
    '  float b = texture2D(uTex, uv - vec2(ch, 0.0)).b;',
    '  vec3 col = vec3(r, g, b);',

    // 偶发反相条带
    '  float bar = hash(vec2(floor(vUv.y * 90.0), seed * 1.7));',
    '  if (bar > 0.965) col = mix(col, vec3(1.0) - col, 0.75);',

    '  col *= uFlash;',
    '  col += (noise(vUv * vec2(620.0 * aspect, 620.0)) - 0.5) * uGrain;',
    '  float d = length((vUv - 0.5) * vec2(aspect * 0.72, 1.0));',
    '  col *= smoothstep(0.86, 0.28, d) * 0.35 + 0.65;',
    '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VS);
  var fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uTex', 'uTime', 'uWarp', 'uRGB', 'uKaleido', 'uZoom', 'uFlash', 'uGrain', 'uTear', 'uAudio', 'uPan', 'uRes', 'uCover']
    .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // 先填一张 1x1 黑，避免纹理未就绪
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  gl.uniform1i(U.uTex, 0);

  var texReady = false;
  var srcImg = document.querySelector('.layer.face');

  function uploadTexture() {
    if (texReady || !srcImg || !srcImg.complete || !srcImg.naturalWidth) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, srcImg);
    texReady = true;
    return true;
  }

  // 图片可能还没下载完，等它就绪再把纹理补上
  if (srcImg && !srcImg.complete) {
    srcImg.addEventListener('load', function () { uploadTexture(); });
  }

  var W = 0, H = 0, texW = 0, texH = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 渲染降分辨率：手机够快，还自带一点胶片糊感；桌面按屏幕来
    var cap = window.innerWidth > 900 ? 1280 : 560;
    var w = Math.round(Math.min(window.innerWidth * dpr, cap));
    var h = Math.round(w * (window.innerHeight / window.innerWidth));
    if (w !== W || h !== H) {
      W = canvas.width = w;
      H = canvas.height = h;
      gl.viewport(0, 0, W, H);
      gl.uniform2f(U.uRes, W, H);
    }

    // 横竖屏切换会换图（picture 元素），纹理和取样比例都要跟着刷新
    var iw = srcImg ? srcImg.naturalWidth : 0;
    var ih = srcImg ? srcImg.naturalHeight : 0;
    if (iw && ih && (iw !== texW || ih !== texH)) {
      texW = iw;
      texH = ih;
      texReady = false;
    }
    if (!texReady) uploadTexture();

    var imgAsp = (texW || 720) / (texH || 1280);
    var scrAsp = window.innerWidth / window.innerHeight;
    if (scrAsp < imgAsp) gl.uniform2f(U.uCover, scrAsp / imgAsp, 1.0);
    else gl.uniform2f(U.uCover, 1.0, imgAsp / scrAsp);
  }

  var S = {
    active: false,
    start: 0,
    warp: 0,
    rgb: 0,
    kaleido: 0,
    zoom: 1,
    flash: 1,
    grain: 0.05,
    tear: 0,
    audio: 0,
    panX: 0,
    panY: 0,
    script: null
  };

  var raf = 0;

  function draw(now) {
    var elapsed = now - S.start;
    var t = elapsed / 1000;

    if (S.script) S.script(t, elapsed);

    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uWarp, S.warp);
    gl.uniform1f(U.uRGB, S.rgb);
    gl.uniform1f(U.uKaleido, S.kaleido);
    gl.uniform1f(U.uZoom, S.zoom);
    gl.uniform1f(U.uFlash, S.flash);
    gl.uniform1f(U.uGrain, S.grain);
    gl.uniform1f(U.uTear, S.tear);
    gl.uniform1f(U.uAudio, S.audio);
    gl.uniform2f(U.uPan, S.panX, S.panY);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S.active) return;
    draw(now);
  }

  return {
    ok: true,

    init: function () {
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
      uploadTexture();
      // 预热一帧，确保着色管线就绪，惊吓时不会卡
      S.active = true;
      S.start = performance.now();
      draw(performance.now());
      S.active = false;
      canvas.style.opacity = '0';
      if (!raf) raf = requestAnimationFrame(frame);
      return this;
    },

    upload: uploadTexture,

    start: function (opt) {
      opt = opt || {};
      resize();
      uploadTexture();
      if (!texReady) return false;        // 纹理没就绪就别接管，交给调用方降级
      S.active = true;
      S.start = performance.now();
      S.zoom = opt.zoom || 1.3;
      S.warp = 0;
      S.rgb = 0;
      S.kaleido = 0;
      S.flash = opt.flash || 1.05;
      S.grain = 0.055;
      S.tear = 0;
      S.audio = 0;
      S.panX = 0;
      S.panY = 0;
      S.script = null;
      canvas.style.transition = 'opacity .06s linear';
      canvas.style.opacity = '1';
      return true;
    },

    /* 疯狂时序：t 单位秒
       0.00 干净的脸（冲击靠"正常"）
       0.18 开始液化
       0.42 万花筒接管
       0.80 骤停，回到干净的脸
       1.05 结束                                           */
    madness: function (opts) {
      opts = opts || {};
      var spin = opts.spin !== false;
      S.script = function (t) {
        var k;
        if (t < 0.18) {
          S.warp = t / 0.18 * 0.035;
          S.rgb = t / 0.18 * 0.0025;
          S.tear = 0;
          S.kaleido = 0;
          S.flash = 1.05 + Math.sin(t * 26) * 0.015;
        } else if (t < 0.42) {
          k = (t - 0.18) / 0.24;
          S.warp = 0.03 + k * 0.11;
          S.rgb = 0.0025 + k * 0.0055;
          S.tear = k * 0.45;
          S.flash = 1.05 - k * 0.08;
        } else if (t < 0.80) {
          k = (t - 0.42) / 0.38;
          S.kaleido = 0.6 + k * 0.4;                  // 0.6 → 1.0：逐步变成完美对称的脸
          S.warp = 0.14 + Math.sin(t * 22) * 0.03;
          S.rgb = 0.008 + k * 0.004;
          S.tear = 0.85 * (1.0 - k * 0.55);   // 后期收敛，把那张完美的对称脸露出来
          S.zoom = 1.0 + k * 0.1;
          S.flash = 0.95 + Math.sin(t * 12) * 0.07;   // 1.9Hz，压在光敏安全线以下
          if (spin) S.panX = Math.sin(t * 9) * 0.008;
        } else if (t < 0.88) {
          // 骤停：一秒之内全部归零，只留一张干净的脸
          S.kaleido = 0;
          S.warp *= 0.2;
          S.rgb = 0.002;
          S.tear = 0;
          S.flash = 1.12;
          S.panX = 0;
          S.zoom = 1.14;
        } else {
          S.warp *= 0.85;
          S.rgb *= 0.8;
          S.flash = 1.05;
        }
      };
    },

    audio: function (v) {
      S.audio = Math.max(0, Math.min(1, v));
    },

    stop: function () {
      S.script = null;
      canvas.style.transition = 'opacity .18s ease-out';
      canvas.style.opacity = '0';
      setTimeout(function () {
        S.active = false;
      }, 220);
    },

    /* 设备撑不住时由外部关掉，自动回落到纯 CSS 版本 */
    disable: function () {
      this.ok = false;
      S.active = false;
      S.script = null;
      canvas.style.display = 'none';
    }
  };
})();
