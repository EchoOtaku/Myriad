/**
 * Mini Game Tapp — 官方轻量游戏能力示例
 *
 * 演示：
 * - Canvas 2D 主循环
 * - Tapp.assets（包内贴图 / JSON）
 * - lifecycle pause/resume（切后台暂停）
 * - Web Audio 程序化音效（不依赖外网）
 * - 可选 media:audio + 包内 wav（若授予）
 * - ui:fullscreen
 */

import type { ExampleTapp, TappCodeStructure } from './types'

// 1×1 红色 PNG
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 极短 8-bit mono WAV（约 0.05s 静音占位，主要用于验证 media-src blob）
const BEEP_WAV_B64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='

// {"title":"Orb Catcher","playerSpeed":320,"spawnIntervalMs":700,"gravity":180}
const LEVEL_JSON_B64 =
  'eyJ0aXRsZSI6Ik9yYiBDYXRjaGVyIiwicGxheWVyU3BlZWQiOjMyMCwic3Bhd25JbnRlcnZhbE1zIjo3MDAsImdyYXZpdHkiOjE4MH0='

const PAGE_HTML = `
<div id="tapp-background">
  <div class="mg-bg"></div>
</div>
<div id="tapp-content" class="mg-root">
  <header class="mg-hud glass">
    <div>
      <h1 id="mg-title" class="mg-title">Orb Catcher</h1>
      <p id="mg-hint" class="mg-hint">← → 或 A/D 移动 · 空格暂停 · F 全屏</p>
    </div>
    <div class="mg-stats">
      <span>Score <strong id="mg-score">0</strong></span>
      <span>Best <strong id="mg-best">0</strong></span>
      <span id="mg-state">Ready</span>
    </div>
  </header>
  <canvas id="mg-canvas" width="640" height="360" aria-label="game canvas"></canvas>
  <footer class="mg-footer glass">
    <button type="button" id="mg-start" class="mg-btn">开始 / 重开</button>
    <button type="button" id="mg-fs" class="mg-btn mg-btn-ghost">全屏</button>
    <span id="mg-assets" class="mg-assets">assets: …</span>
  </footer>
</div>
`

const PAGE_CSS = `
.mg-root {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
  color: var(--tapp-text, #1a1a1a);
}
.dark .mg-root { color: rgba(255,255,255,.92); }
.mg-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(1200px 500px at 20% -10%, color-mix(in srgb, var(--tapp-primary, #6366f1) 35%, transparent), transparent 60%),
    radial-gradient(900px 400px at 90% 10%, color-mix(in srgb, #22d3ee 25%, transparent), transparent 55%),
    linear-gradient(180deg, #0b1020, #121826 60%, #0a0f1a);
}
.mg-hud, .mg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--tapp-primary, #6366f1) 25%, transparent);
  background: color-mix(in srgb, #0f172a 55%, transparent);
  backdrop-filter: blur(10px);
}
.mg-title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: .02em; }
.mg-hint { margin: 4px 0 0; font-size: 12px; opacity: .7; }
.mg-stats { display: flex; gap: 14px; font-size: 13px; align-items: center; flex-wrap: wrap; }
.mg-stats strong { font-variant-numeric: tabular-nums; }
#mg-canvas {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  aspect-ratio: 16 / 9;
  height: auto;
  display: block;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,.08);
  background: #0a1220;
  box-shadow: 0 20px 50px -24px rgba(0,0,0,.6);
  touch-action: none;
}
.mg-footer { justify-content: flex-start; flex-wrap: wrap; }
.mg-btn {
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
  color: #0b1020;
  background: linear-gradient(135deg, #a5b4fc, #67e8f9);
}
.mg-btn-ghost {
  color: rgba(255,255,255,.9);
  background: transparent;
  border: 1px solid rgba(255,255,255,.18);
}
.mg-assets { font-size: 12px; opacity: .65; margin-left: auto; }
`

const PAGE_JS = `
(function () {
  'use strict';

  var canvas = document.getElementById('mg-canvas');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('mg-score');
  var bestEl = document.getElementById('mg-best');
  var stateEl = document.getElementById('mg-state');
  var assetsEl = document.getElementById('mg-assets');
  var titleEl = document.getElementById('mg-title');

  var W = canvas.width;
  var H = canvas.height;
  var keys = Object.create(null);
  var running = false;
  var paused = false;
  var hostPaused = false;
  var raf = 0;
  var lastTs = 0;
  var score = 0;
  var best = 0;
  var spawnAcc = 0;
  var player = { x: W / 2, y: H - 36, w: 56, h: 14, speed: 320 };
  var orbs = [];
  var conf = { title: 'Orb Catcher', playerSpeed: 320, spawnIntervalMs: 700, gravity: 180 };
  var sprite = null;
  var audioCtx = null;
  var packageBeepUrl = null;

  function setState(text) {
    if (stateEl) stateEl.textContent = text;
  }

  function resizeCssCanvas() {
    // keep internal resolution fixed; CSS handles display size
  }

  function playTone(freq, duration) {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  function playPackageBeep() {
    if (!packageBeepUrl) return;
    try {
      var a = new Audio(packageBeepUrl);
      a.volume = 0.4;
      a.play().catch(function () {});
    } catch (e) {}
  }

  function resetGame() {
    score = 0;
    orbs = [];
    spawnAcc = 0;
    player.x = W / 2;
    scoreEl.textContent = '0';
    setState('Playing');
  }

  function spawnOrb() {
    orbs.push({
      x: 24 + Math.random() * (W - 48),
      y: -12,
      r: 8 + Math.random() * 8,
      vy: conf.gravity * (0.7 + Math.random() * 0.6),
      hue: 180 + Math.random() * 120
    });
  }

  function update(dt) {
    if (!running || paused || hostPaused) return;
    var dir = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dir -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dir += 1;
    player.x += dir * player.speed * dt;
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));

    spawnAcc += dt * 1000;
    while (spawnAcc >= conf.spawnIntervalMs) {
      spawnAcc -= conf.spawnIntervalMs;
      spawnOrb();
    }

    for (var i = orbs.length - 1; i >= 0; i--) {
      var o = orbs[i];
      o.y += o.vy * dt;
      var hit =
        o.y + o.r >= player.y - player.h / 2 &&
        o.y - o.r <= player.y + player.h / 2 &&
        o.x >= player.x - player.w / 2 &&
        o.x <= player.x + player.w / 2;
      if (hit) {
        orbs.splice(i, 1);
        score += 1;
        scoreEl.textContent = String(score);
        if (score > best) {
          best = score;
          bestEl.textContent = String(best);
          try { Tapp.storage.set('best', best); } catch (e) {}
        }
        playTone(660 + Math.min(score, 12) * 20, 0.07);
        playPackageBeep();
        continue;
      }
      if (o.y - o.r > H + 20) {
        orbs.splice(i, 1);
        running = false;
        setState('Missed — press Start');
        playTone(140, 0.18);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // backdrop grid
    ctx.fillStyle = '#0a1220';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < W; gx += 32) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy < H; gy += 32) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // orbs
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (sprite) {
        ctx.drawImage(sprite, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
        ctx.globalCompositeOperation = 'source-atop';
      }
      var g = ctx.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, 1, o.x, o.y, o.r);
      g.addColorStop(0, 'hsla(' + o.hue + ',90%,75%,1)');
      g.addColorStop(1, 'hsla(' + o.hue + ',80%,45%,0.85)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // player paddle
    var px = player.x - player.w / 2;
    var py = player.y - player.h / 2;
    var pg = ctx.createLinearGradient(px, py, px + player.w, py);
    pg.addColorStop(0, '#67e8f9');
    pg.addColorStop(1, '#a5b4fc');
    ctx.fillStyle = pg;
    ctx.fillRect(px, py, player.w, player.h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px, py, player.w, 3);

    if (!running) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '700 22px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(score ? 'Game Over' : 'Ready', W / 2, H / 2 - 8);
      ctx.font = '14px system-ui,sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Press Start or Space', W / 2, H / 2 + 18);
    } else if (paused || hostPaused) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 22px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(hostPaused ? 'Paused (hidden)' : 'Paused', W / 2, H / 2);
    }
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.033, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    lastTs = 0;
    raf = requestAnimationFrame(frame);
  }

  function startGame() {
    resetGame();
    running = true;
    paused = false;
    player.speed = conf.playerSpeed || 320;
    playTone(520, 0.06);
    setState('Playing');
  }

  function togglePause() {
    if (!running) {
      startGame();
      return;
    }
    paused = !paused;
    setState(paused ? 'Paused' : 'Playing');
  }

  window.addEventListener('keydown', function (e) {
    keys[e.key] = true;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePause();
    }
    if (e.key === 'f' || e.key === 'F') {
      Tapp.ui.fullscreen.toggle().catch(function () {});
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.key] = false; });

  // touch / pointer drag
  var dragging = false;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    var rect = canvas.getBoundingClientRect();
    player.x = ((e.clientX - rect.left) / rect.width) * W;
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var rect = canvas.getBoundingClientRect();
    player.x = ((e.clientX - rect.left) / rect.width) * W;
  });
  canvas.addEventListener('pointerup', function () { dragging = false; });
  canvas.addEventListener('pointercancel', function () { dragging = false; });

  document.getElementById('mg-start').addEventListener('click', startGame);
  document.getElementById('mg-fs').addEventListener('click', function () {
    Tapp.ui.fullscreen.toggle().catch(function () {});
  });

  Tapp.lifecycle.onPause(function () {
    hostPaused = true;
    setState('Paused (hidden)');
    try { if (audioCtx && audioCtx.state === 'running') audioCtx.suspend(); } catch (e) {}
  });
  Tapp.lifecycle.onResume(function () {
    hostPaused = false;
    if (running && !paused) setState('Playing');
    try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
  });
  Tapp.lifecycle.onDestroy(function () {
    if (raf) cancelAnimationFrame(raf);
    try { Tapp.assets.revokeAll(); } catch (e) {}
    try { if (audioCtx) audioCtx.close(); } catch (e) {}
  });

  Tapp.lifecycle.onReady(async function () {
    startLoop();
    draw();
    try {
      var stored = await Tapp.storage.get('best');
      if (typeof stored === 'number') {
        best = stored;
        bestEl.textContent = String(best);
      }
    } catch (e) {}

    try {
      var list = await Tapp.assets.list();
      assetsEl.textContent = 'assets: ' + (list && list.length ? list.join(', ') : '(none)');
      var level = await Tapp.assets.getArrayBuffer('assets/level.json');
      var text = new TextDecoder().decode(new Uint8Array(level.buffer));
      conf = Object.assign(conf, JSON.parse(text));
      titleEl.textContent = conf.title || 'Orb Catcher';
      player.speed = conf.playerSpeed || player.speed;

      var pixel = await Tapp.assets.getUrl('assets/pixel.png');
      var img = new Image();
      img.src = pixel.url;
      await new Promise(function (resolve, reject) {
        img.onload = resolve;
        img.onerror = reject;
      });
      sprite = img;

      if (Tapp.permissions && Tapp.permissions.indexOf('media:audio') >= 0) {
        var beep = await Tapp.assets.getUrl('assets/beep.wav');
        packageBeepUrl = beep.url;
      }
    } catch (err) {
      console.warn('[MiniGame] assets load failed', err);
      assetsEl.textContent = 'assets: load failed';
    }
  });
})();
`

const code: TappCodeStructure = {
  core: `
// Mini Game core — shared placeholders; gameplay lives in page.
console.log('[MiniGame] core loaded');
`,
  page: PAGE_JS,
  pageHtml: PAGE_HTML,
  styles: PAGE_CSS,
  assets: {
    'assets/pixel.png': PIXEL_PNG_B64,
    'assets/beep.wav': BEEP_WAV_B64,
    'assets/level.json': LEVEL_JSON_B64,
  },
}

export const miniGameTapp: ExampleTapp = {
  manifest: {
    id: 'com.myriad.mini-game',
    name: 'Orb Catcher',
    version: '1.0.0',
    description:
      '官方轻量游戏示例：Canvas 2D、包内 assets、pause/resume 与可选包内音频。',
    category: 'game',
    main: 'main.js',
    author: { name: 'Myriad' },
    icon: '🎮',
    themeColor: '#6366f1',
    hasPage: true,
    permissions: ['storage', 'ui:fullscreen', 'media:audio'],
    assets: ['assets/pixel.png', 'assets/beep.wav', 'assets/level.json'],
    pageTemplate: 'page.html',
    styles: 'styles.css',
  },
  code,
  tags: ['game', 'canvas', 'assets', 'official'],
}

export default miniGameTapp
