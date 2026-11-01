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
    'uniform float uShatter;',   // 碎片化
    'uniform float uAudio;',     // 音频能量 0..1
    'uniform vec2  uPan;',       // 画面偏移
    'uniform vec2  uRes;',
    'uniform vec2  uCover;',
    'uniform float uUnder;',   // 底光强度
    'uniform vec4  uGrade;',      // x=饱和度 y=桶形畸变 z=高光提亮 w=颗粒
    'uniform vec3  uTint;',       // 整体色调
    'uniform vec2  uPulse;',      // x=眼睛睁大 y=嘴角抽动
    'uniform sampler2D uEyeTex;',
    'uniform float uEyeMode;',
    'uniform vec2  uGaze;',
    'uniform float uTurn;',
    'uniform float uTilt;',

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
    // 眼睛模式：把平面的眼睛图当成两个球来转（位移 ∝ z：中心动得多，边缘几乎不动）
    '  if (uEyeMode > 0.5) {',
    '    float easp = uRes.x / uRes.y;',
    '    vec2 uv0 = (vUv - 0.5) / uZoom + 0.5;',
    '    vec2 rad = vec2(0.112, 0.112 * easp);',
    '    vec2 cL = vec2(0.372, 0.466);',
    '    vec2 cR = vec2(0.628, 0.466);',
    '    vec2 dL = (uv0 - cL) / rad;',
    '    vec2 dR = (uv0 - cR) / rad;',
    '    float lL = length(dL);',
    '    float lR = length(dR);',
    '    vec2 suv = uv0;',
    '    float zz = 0.0;',
    '    float edge = 0.0;',
    '    if (lL < 1.0) { float zA = sqrt(1.0 - lL * lL); suv = uv0 - uGaze * zA * rad; zz = zA; edge = lL; }',
    '    else if (lR < 1.0) { float zB = sqrt(1.0 - lR * lR); suv = uv0 - uGaze * zB * rad; zz = zB; edge = lR; }',
    '    vec3 ecol = texture2D(uEyeTex, suv).rgb;',
    '    ecol += vec3(pow(zz, 26.0) * 0.14);',
    '    ecol *= mix(1.0, 0.62, smoothstep(0.72, 1.0, edge));',
    '    gl_FragColor = vec4(max(ecol, 0.0), 1.0);',
    '    return;',
    '  }',
    '  float aspect = uRes.x / uRes.y;',
    '  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uPan;',

    // 对称化：把左半张脸镜像到右半。
    // 万花筒会把任何照片都搅成花瓣，而"完美对称的人脸"才是真正的恐怖谷
    '  if (uKaleido > 0.01) {',
    '    float mx = (uv.x > 0.5) ? (1.0 - uv.x) : uv.x;',
    '    uv.x = mix(uv.x, mx, uKaleido);',
    '  }',

    // 伪 3D：仿射斜切，模拟甩头和仰头（一张图也能演）
    '  uv.x += uTurn * (uv.y - 0.5) * 0.42;',
    '  uv.y += uTilt * (uv.x - 0.5) * 0.28;',

    // 局部脉冲：每隔一两秒，眼睛突然睁大一下 / 嘴角抽一下
    '  if (uPulse.x > 0.01) {',
    '    vec2 ec = vec2(0.5, 0.30);',
    '    vec2 ed = uv - ec;',
    '    float er = length(ed * vec2(aspect, 1.0));',
    '    float em = smoothstep(0.40, 0.0, er) * uPulse.x;',
    '    uv = mix(uv, ec + ed * 0.88, em);',
    '  }',
    '  if (uPulse.y > 0.01) {',
    '    vec2 mc = vec2(0.5, 0.66);',
    '    vec2 md = uv - mc;',
    '    float mm = smoothstep(0.48, 0.0, length(md * vec2(aspect * 0.75, 1.7))) * uPulse.y;',
    '    uv = mix(uv, mc + md * vec2(0.84, 1.0), mm);',
    '  }',

    // 桶形畸变：像贴得太近的广角镜头
    '  vec2 lp = vUv - 0.5;',
    '  float lr2 = dot(lp, lp);',
    '  lp *= 1.0 + uGrade.y * lr2 * 1.1;',
    '  uv += lp - (vUv - 0.5);',

    // 等比例裁切（模拟 object-fit: cover），否则脸会被横向压扁
    '  uv = (uv - 0.5) * uCover + 0.5;',

    // 液化：一层噪声推 UV（只算一次，省一半采样）
    '  float t = uTime;',
    '  float amp = uWarp * (0.6 + uAudio * 0.5);',
    '  vec2 w1 = vec2(noise(uv * 5.0 + vec2(t * 0.8, -t * 0.6)),',
    '                 noise(uv * 5.0 + vec2(-t * 0.5, t * 0.9) + 17.0)) - 0.5;',
    '  uv += w1 * amp;',

    // 碎片化：整张脸被打碎成块，每块各走各的
    '  if (uShatter > 0.01) {',
    '    vec2 g = vec2(5.0, 9.0) * (0.4 + uShatter * 0.6);',
    '    vec2 cell = floor(uv * g);',
    '    float st = floor(t * 9.0);',
    '    float r1 = hash(cell + st * 1.37);',
    '    float r2 = hash(cell + 17.0 + st * 0.71);',
    '    uv += (vec2(r1, r2) - 0.5) * 0.055 * uShatter;',
    '  }',

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

    // 底光：下巴亮、额头沉进黑暗，阴影往上爬 —— 日光从不这样打
    '  float ug = smoothstep(0.02, 0.98, vUv.y);',
    '  float underMul = mix(1.58, 0.38, ug);',
    '  col *= mix(1.0, underMul, uUnder);',

    // 偶发反相条带
    '  float bar = hash(vec2(floor(vUv.y * 90.0), seed * 1.7));',
    '  if (bar > 0.965) col = mix(col, vec3(1.0) - col, 0.75);',

    // 色彩分级：降饱和 + 单一色偏，去 AI 味
    '  float luma = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(luma), col, uGrade.x) * uTint;',

    // 高光提亮：牙齿和眼白先亮起来
    '  col += smoothstep(0.62, 0.98, luma) * uGrade.z;',

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
  ['uTex', 'uTime', 'uWarp', 'uRGB', 'uKaleido', 'uZoom', 'uFlash', 'uGrain', 'uTear', 'uShatter', 'uAudio', 'uPan', 'uRes', 'uCover', 'uTurn', 'uTilt', 'uUnder', 'uGrade', 'uTint', 'uPulse', 'uEyeTex', 'uEyeMode', 'uGaze']
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

  // 第二张纹理：眼睛特写（横竖屏各一张，取当前显示的那张）
  var texEye = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texEye);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0]));
  gl.activeTexture(gl.TEXTURE0);
  var eyeImg = document.querySelector('#eyeShot picture.base img');
  var eyeTexReady = false, eyeTexW = 0, eyeTexH = 0;

  function uploadEye() {
    if (!eyeImg) return false;
    if (eyeImg.naturalWidth && (eyeImg.naturalWidth !== eyeTexW || eyeImg.naturalHeight !== eyeTexH)) {
      eyeTexW = eyeImg.naturalWidth; eyeTexH = eyeImg.naturalHeight; eyeTexReady = false;
    }
    if (eyeTexReady || !eyeImg.complete || !eyeImg.naturalWidth) return eyeTexReady;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texEye);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, eyeImg);
    gl.activeTexture(gl.TEXTURE0);
    eyeTexReady = true;
    return true;
  }

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

  function rnd(n) { var x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

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
    shatter: 0,
    turn: 0,
    tilt: 0,
    under: 0,
    eyeMode: 0,
    eyeDur: 1.5,
    gazeX: 0,
    gazeY: 0,
    sat: 1.0,
    lens: 0,
    hi: 0,
    tint: [1, 1, 1],
    eyePulse: 0,
    mouthPulse: 0,
    audio: 0,
    panX: 0,
    panY: 0,
    script: null
  };

  var raf = 0;

  function draw(now) {
    var elapsed = now - S.start;
    var t = elapsed / 1000;

    if (S.eyeMode) {
      var u = Math.min(1, t / S.eyeDur);
      // 推近：前 80% 极慢，最后 20% 猛冲
      S.zoom = u < 0.8 ? 1.0 + u * 0.1125 : 1.09 + ((u - 0.8) / 0.2) * 0.36;
      // 眼珠：突然瞟走，再转回来盯你（硬跳，不做平滑）
      var gx = 0, gy = 0;
      if (u > 0.40 && u < 0.53) { gx = -0.30; gy = 0.16; }
      else if (u > 0.75 && u < 0.81) { gx = 0.23; gy = -0.12; }
      S.gazeX = gx;
      S.gazeY = gy;
    }

    if (S.script) S.script(t, elapsed);

    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uWarp, S.warp);
    gl.uniform1f(U.uRGB, S.rgb);
    gl.uniform1f(U.uKaleido, S.kaleido);
    gl.uniform1f(U.uZoom, S.zoom);
    gl.uniform1f(U.uFlash, S.flash);
    gl.uniform1f(U.uGrain, S.grain);
    gl.uniform1f(U.uTear, S.tear);
    gl.uniform1f(U.uShatter, S.shatter);
    gl.uniform1f(U.uUnder, S.under);
    gl.uniform4f(U.uGrade, S.sat, S.lens, S.hi, S.grain);
    gl.uniform3f(U.uTint, S.tint[0], S.tint[1], S.tint[2]);
    gl.uniform2f(U.uPulse, S.eyePulse, S.mouthPulse);
    gl.uniform1f(U.uEyeMode, S.eyeMode);
    gl.uniform2f(U.uGaze, S.gazeX, S.gazeY);
    gl.uniform1i(U.uEyeTex, 1);
    gl.uniform1f(U.uTurn, S.turn);
    gl.uniform1f(U.uTilt, S.tilt);
    gl.uniform1f(U.uAudio, S.audio);
    gl.uniform2f(U.uPan, S.panX, S.panY);

    if (S.eyeMode) {
      uploadEye();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texEye);
      gl.uniform1i(U.uEyeTex, 1);
      gl.activeTexture(gl.TEXTURE0);
    }
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
      S.shatter = 0;
      S.turn = 0;
      S.tilt = 0;
      // ---- R1~R7 迭代后的最终配比 ----
      S.under = 1;                 // 底光：额头沉进黑暗，只有下巴和牙在亮
      S.sat = 0.80;                // 只轻微降饱和：保住"白脸+血红"这个原配色
      S.lens = 0.20;               // 畸变收一半：有压迫感，但不至于"忙"
      S.hi = 0.06;                 // 高光几乎不加，多了就是塑料
      S.tint = [1.0, 1.0, 1.0];    // 不额外偏色 —— 小丑本身的配色已经是答案
      S.eyePulse = 0;
      S.mouthPulse = 0;
      S.grain = 0.055;
      S.audio = 0;
      S.panX = 0;
      S.panY = 0.05;
      S.eyeMode = 0;               // 画面略微上移，额头被切出框外
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
      var total = opts.total || 0.9;
      S.script = function (t) {
        var u = Math.min(1, t / total);   // 归一化：无论多长都完整走一遍
        var k;
        if (u < 0.17) {
          k = u / 0.17;
          S.warp = k * 0.03;
          S.rgb = k * 0.002;
          S.tear = 0; S.kaleido = 0; S.shatter = 0;
          S.flash = 1.05 + Math.sin(t * 26) * 0.015;
          // 干净的那几帧里也会突然变一下 —— 你不敢确定自己看错了没有
          var st0 = Math.floor(t * 16);
          S.eyePulse = rnd(st0 * 2.3) > 0.80 ? 1 : 0;
          S.mouthPulse = rnd(st0 * 4.1 + 7) > 0.88 ? 1 : 0;
        } else if (u < 0.42) {
          k = (u - 0.17) / 0.25;
          S.warp = 0.03 + k * 0.11;
          S.kaleido = k * 0.85;
          S.rgb = 0.002 + k * 0.005;
          S.shatter = 0;
          S.tear = k * 0.3;
          S.flash = 1.05 - k * 0.07;
        } else if (u < 0.66) {
          k = (u - 0.42) / 0.24;
          S.warp = 0.14;
          S.kaleido = 0.85 + k * 0.15;
          S.turn = Math.sin(t * 26) * 0.25 * k;
          S.tilt = Math.cos(t * 19) * 0.15 * k;
          S.shatter = k * 0.55;
          S.rgb = 0.007 + k * 0.006;
          S.tear = 0.3;
          S.flash = 0.98;
          S.zoom = 1.0 + k * 0.04;
        } else if (u < 0.90) {
          k = (u - 0.66) / 0.24;
          S.kaleido = 0.55;          // 别加到满，留一点不对称，脸才认得出来
          S.shatter = 0.55 + k * 0.45;
          S.warp = 0.16 + Math.sin(t * 30) * 0.05;
          S.rgb = 0.013 + k * 0.012;
          S.tear = 0.7;
          S.zoom = 1.04 + k * 0.06;
          S.flash = 0.92 + Math.sin(t * 12) * 0.08;
          if (spin) S.panX = Math.sin(t * 11) * 0.01;
          // 每 90ms 猛甩一次头，方向随机 —— 这才是"神经出问题"
          var stp = Math.floor(t * 11);
          S.turn = (rnd(stp) - 0.5) * 1.5;
          S.tilt = (rnd(stp + 7.7) - 0.5) * 0.9;
          // 表情抽动：每 71ms 掷一次骰子，眼睛和嘴角各约 8%
          S.eyePulse = rnd(stp * 3.1) > 0.92 ? 1 : 0;
          S.mouthPulse = rnd(stp * 5.7 + 11) > 0.93 ? 1 : 0;
        } else if (u < 0.97) {
          // 骤停：全部归零，只剩一张干净的脸瞪着镜头
          S.kaleido = 0; S.shatter = 0; S.turn = 0; S.tilt = 0;
          S.warp *= 0.15; S.rgb = 0.002; S.tear = 0;
          S.flash = 1.14; S.panX = 0; S.zoom = 1.12;
        } else {
          S.warp *= 0.85; S.rgb *= 0.8; S.flash = 1.05;
        }
      };
    },

    /* 闪帧：70ms 的极端画面。人几乎看不见，但会莫名心悸 —— 电影里最阴的一招 */
    flashFrames: function (ms) {
      resize();
      uploadTexture();
      if (!texReady) return false;
      S.active = true;
      S.start = performance.now();
      S.zoom = 1.12;
      S.warp = 0.45;
      S.rgb = 0.035;
      S.kaleido = 1.0;
      S.shatter = 0.9;
      S.flash = 1.45;
      S.grain = 0.12;
      S.tear = 1.0;
      S.audio = 0;
      S.script = null;
      canvas.style.transition = 'none';
      canvas.style.opacity = '1';
      setTimeout(function () {
        canvas.style.transition = 'opacity .12s linear';
        canvas.style.opacity = '0';
        setTimeout(function () { S.active = false; }, 150);
      }, ms || 70);
      return true;
    },

    /* 眼睛特写：把平面的眼睛当球转 */
    eyeStart: function (ms) {
      resize();
      uploadEye();
      if (!eyeTexReady) return false;
      S.active = true;
      S.start = performance.now();
      S.eyeMode = 1;
      S.eyeDur = (ms || 1500) / 1000;
      S.zoom = 1.0;
      S.gazeX = 0;
      S.gazeY = 0;
      S.script = null;
      canvas.style.transition = 'opacity .05s linear';
      canvas.style.opacity = '1';
      return true;
    },

    eyeStop: function () {
      S.eyeMode = 0;
      canvas.style.transition = 'opacity .12s linear';
      canvas.style.opacity = '0';
      setTimeout(function () { S.active = false; }, 150);
    },

    /* 供离线评测用：一次性设定所有视觉参数 */
    setLook: function (o) {
      if (!o) return;
      if (o.under !== undefined) S.under = o.under;
      if (o.sat !== undefined) S.sat = o.sat;
      if (o.lens !== undefined) S.lens = o.lens;
      if (o.hi !== undefined) S.hi = o.hi;
      if (o.grain !== undefined) S.grain = o.grain;
      if (o.tint) S.tint = o.tint;
      if (o.zoom !== undefined) S.zoom = o.zoom;
      if (o.panX !== undefined) S.panX = o.panX;
      if (o.panY !== undefined) S.panY = o.panY;
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
