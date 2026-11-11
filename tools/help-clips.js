#!/usr/bin/env node
// Record the short looping clips on help.html as animated WebP.
//
//   node tools/help-clips.js            # all clips, desktop size (help/*.webp)
//   node tools/help-clips.js record     # just one
//   node tools/help-clips.js --phone    # the same clips at phone size, by touch (help/phone/*.webp)
//
// Serves the repo locally, drives the piano with Playwright (a drawn cursor shows where the "user" points,
// a key cap shows computer keys pressed), captures a frame per step and writes help/<name>.webp. Clips are
// silent: they show what to do, the sound is for the page itself. Re-run after UI changes so the help page
// matches the app.
import http from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Phone clips show what a phone shows: the narrow layout, a fingertip for a pointer, and taps on the on-screen
// keys and buttons where the desktop clips press computer keys (a phone has none).
const PHONE = process.argv.includes('--phone');
const OUT = join(ROOT, PHONE ? 'help/phone' : 'help');
const PORT = 8097;
const VIEW = PHONE ? { width: 412, height: 900 } : { width: 1200, height: 860 };
const CROP = PHONE ? { width: 412, height: 600 } : { width: 1200, height: 640 };   // written at 618 × 900 or 900 × 480
const SCALE = PHONE ? 1.5 : 0.75;
const DPR = PHONE ? 2 : 1;

// ── a tiny static server ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ogg': 'audio/ogg', '.png': 'image/png', '.mid': 'audio/midi', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/\/$/, '/index.html'));
  try { const body = await readFile(path); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});

// the pointer, and a key cap for computer keys, drawn into the page so screenshots show them
const OVERLAY_JS = (phone) => {
  const c = document.createElement('div');
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: 0, top: 0, zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)' });
  const ring = document.createElement('div');
  Object.assign(ring.style, { position: 'fixed', width: '28px', height: '28px', borderRadius: '50%', zIndex: 2147483646, border: '2px solid #FFE066', pointerEvents: 'none', opacity: 0, left: 0, top: 0 });
  const cap = document.createElement('div');
  Object.assign(cap.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: 2147483647, pointerEvents: 'none', display: 'none',
    font: '12px "Press Start 2P", monospace', color: '#080B14', background: '#FFE066', borderRadius: '8px', padding: '10px 14px', boxShadow: '0 0 16px rgba(255,224,102,.8)' });
  if (phone) {   // a fingertip, and no key cap
    c.innerHTML = '<div style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.5);transform:translate(-10px,-11px)"></div>';
    cap.style.visibility = 'hidden';
  }
  document.body.append(c, ring, cap);
  addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; }, true);
  addEventListener('mousedown', e => { ring.style.transform = `translate(${e.clientX - 14}px, ${e.clientY - 14}px)`; ring.style.opacity = 1; }, true);
  addEventListener('mouseup', () => setTimeout(() => { ring.style.opacity = 0; }, 250), true);
  const held = new Set();
  const show = () => { cap.style.display = held.size ? 'block' : 'none'; cap.textContent = [...held].join(' + '); };
  const label = k => ({ ' ': 'SPACE', ArrowUp: '↑', ArrowDown: '↓', Enter: 'ENTER' }[k] || k.toUpperCase());
  addEventListener('keydown', e => { if (e.target.matches && e.target.matches('input[type="text"]')) return; held.add(label(e.key)); show(); }, true);
  addEventListener('keyup', e => { held.delete(label(e.key)); show(); }, true);
};

class Clip {
  constructor(page) { this.page = page; this.frames = []; this.pos = [VIEW.width / 2, VIEW.height / 2]; this.top = 0; }
  async snap(ms = 70) {
    const png = await this.page.screenshot({ clip: { x: 0, y: this.top, ...CROP } });
    this.frames.push([png, ms]);
  }
  hold(ms) { return this.snap(ms); }
  // frame the clip on the piano as it now stands (the page centers itself, so it moves when a song loads):
  // from just above the note pills down; the key cap sits in the frame's corner
  async frame(lift = 24) {
    this.top = Math.max(0, Math.round(await this.page.evaluate(() => document.getElementById('activeNotes').getBoundingClientRect().top) - lift));
    await this.page.evaluate(([top, h]) => { const cap = document.body.lastElementChild; cap.style.bottom = 'auto'; cap.style.top = (top + h - 64) + 'px'; }, [this.top, CROP.height]);
  }
  async wait(ms) { await this.page.waitForTimeout(ms); }
  // frames while time passes (playback)
  async run(ms, every = 160) { for (let t = 0; t < ms; t += every) { await this.wait(every - 40); await this.snap(every); } }
  async move(x, y, steps = 10) {
    const [x0, y0] = this.pos;
    for (let i = 1; i <= steps; i++) { await this.page.mouse.move(x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps); await this.snap(40); }
    this.pos = [x, y];
  }
  async to(loc, steps = 10, dx = 0.5, dy = 0.5) {
    const b = await loc.boundingBox();
    await this.move(b.x + b.width * dx, b.y + b.height * dy, steps);
  }
  async click(loc, { steps = 10, settle = 400 } = {}) {
    if (loc) await this.to(loc, steps);
    await this.page.mouse.down(); await this.snap(90);
    await this.page.mouse.up(); await this.wait(settle); await this.snap(350);
  }
  // the on-screen piano key that a computer key plays
  pianoKey(k) { return this.page.locator('.key').filter({ has: this.page.locator('.key-label', { hasText: new RegExp('^' + k.toUpperCase() + '$') }) }).first(); }
  async key(k, holdMs = 260) {   // a computer key, held a moment; on a phone, a tap on that piano key
    if (PHONE) {
      if (!/^[a-z;']$/i.test(k)) return;            // octave digits and the like: no such keys on a phone
      const key = this.pianoKey(k);
      await key.scrollIntoViewIfNeeded();
      await this.to(key, 6, 0.5, 0.8);
      await this.page.mouse.down(); await this.snap(holdMs);
      await this.page.mouse.up(); await this.snap(90);
      return;
    }
    await this.page.keyboard.down(k); await this.snap(holdMs);
    await this.page.keyboard.up(k); await this.snap(90);
  }
  // the sustain pedal: Space on a computer, the SUSTAIN button on a phone
  async pedal(down) {
    if (PHONE) { await this.click(this.page.locator('#btnSustain'), { steps: 8, settle: 150 }); return; }
    if (down) await this.page.keyboard.down(' '); else await this.page.keyboard.up(' ');
    await this.snap(200);
  }
  // several keys at once: held together on a computer; on a phone, tapped in turn (the pedal holds them)
  async chord(keys) {
    if (PHONE) { for (const k of keys) await this.key(k, 140); return; }
    for (const k of keys) { await this.page.keyboard.down(k); await this.snap(120); }
    await this.hold(400);
    for (const k of keys) { await this.page.keyboard.up(k); await this.snap(80); }
  }
  async type(text) { for (const ch of text) { await this.page.keyboard.type(ch); await this.wait(40); await this.snap(100); } }
  async drag(x0, y0, x1, y1, steps = 16) {
    await this.move(x0, y0);
    await this.page.mouse.down(); await this.snap(150);
    for (let i = 1; i <= steps; i++) { await this.page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await this.snap(50); }
    await this.page.mouse.up(); this.pos = [x1, y1]; await this.wait(300); await this.snap(300);
  }
  async save(name) {
    await mkdir(OUT, { recursive: true });
    const imgs = await Promise.all(this.frames.map(([png]) => sharp(png).resize(Math.round(CROP.width * SCALE)).png().toBuffer()));
    const delay = this.frames.map(([, ms]) => ms);
    delay[delay.length - 1] = Math.max(delay.at(-1), 1800);   // rest on the result before looping
    const path = join(OUT, name + '.webp');
    await sharp(imgs, { join: { animated: true } }).webp({ quality: 70, effort: 5, delay, loop: 0 }).toFile(path);
    console.log(`${name}: ${imgs.length} frames, ${(delay.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s, ${Math.round((await stat(path)).size / 1024)}KB`);
  }
}

async function openApp(page) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => /click a key/.test(document.getElementById('status').textContent));
  await page.evaluate(OVERLAY_JS, PHONE);
  await page.waitForTimeout(300);
}
const canon = page => page.waitForEvent('filechooser').then(fc => fc.setFiles(join(ROOT, 'songs/canon-in-d.mid')));
const $ = (page, sel) => page.locator(sel);

// ── the clips ──
const CLIPS = {
  // keys by mouse and keyboard, the pedal, the pitch wheel, the octave
  async play(c) {
    const p = c.page;
    await openApp(p); await c.frame(); await c.hold(600);
    for (const n of ['C4', 'E4', 'G4']) {   // white keys, low down where the black keys don't reach
      await c.to(p.locator('.key.white').filter({ has: p.locator('.key-note', { hasText: new RegExp('^' + n + '$') }) }), 8, 0.5, 0.85);
      await c.click(null, { settle: 200 });
    }
    await c.hold(400);
    await c.key('a'); await c.key('d'); await c.key('g'); await c.key('k', 600);
    // a chord held with the pedal
    await c.pedal(true);
    await c.chord(['a', 'd', 'g']);
    await c.hold(600);
    if (PHONE) {   // the wheel and the octave buttons live in the side panel on a phone: the sound clip opens it
      await c.pedal(false);
      await c.hold(900);
      return;
    }
    // bend it with the wheel, let go: it springs back
    const t = await $(p, '#pitchThumb').boundingBox();
    await c.drag(t.x + t.width / 2, t.y + t.height / 2, t.x + t.width / 2, t.y - 60, 14);
    await c.run(500, 80);
    await c.pedal(false);
    // octave up with 4, and the range label moves
    await c.key('4', 300); await c.key('a', 500);
    await c.key('3', 300);
    await c.hold(800);
  },

  // OPEN the Canon: its instruments, choosing which play
  async open(c) {
    const p = c.page;
    await openApp(p); await c.frame(70); await c.hold(600);
    const chose = canon(p);
    await c.click($(p, '#btnOpen'), { steps: 14, settle: 100 });
    await chose; await c.wait(400);
    await c.snap(1400);
    await c.click($(p, '#partList label:nth-child(2) input'), { steps: 14, settle: 300 });
    await c.click($(p, '#partList label:nth-child(3) input'), { steps: 8, settle: 300 });
    await c.to($(p, '#status'), 12); await c.hold(1200);
    await c.click($(p, '#partList label:nth-child(2) input'), { steps: 12, settle: 200 });
    await c.click($(p, '#partList label:nth-child(3) input'), { steps: 8, settle: 300 });
    await c.hold(1000);
  },

  // PLAY / PAUSE, the seek bar, ⏪ ⏩, and the octave moving the view
  async transport(c) {
    const p = c.page;
    await openApp(p);
    await p.setInputFiles('#midiFile', join(ROOT, 'songs/canon-in-d.mid')); await c.wait(300);
    await c.frame(); await c.hold(500);
    await c.click($(p, '#btnPlay'), { steps: 12, settle: 100 });
    await c.run(1800);
    // the bass is below the keys in view: ◀ 1. Octave −2 (key 1) shows it
    await c.to($(p, '#lowMore'), 12); await c.run(900);
    await c.key('1', 200); await c.run(1600);
    await c.key('3', 200);
    // jump into the middle
    const s = await $(p, '#seek').boundingBox();
    await c.drag(s.x + s.width * 0.02, s.y + s.height / 2, s.x + s.width * 0.45, s.y + s.height / 2, 14);
    await c.run(2000);
    await c.click($(p, '#btnFwd'), { steps: 10, settle: 100 }); await c.run(1200);
    await c.click($(p, '#btnPlay'), { steps: 10, settle: 200 });   // pause
    await c.hold(1400);
  },

  // REC, play, STOP, name it
  async record(c) {
    const p = c.page;
    await openApp(p); await c.frame(50); await c.hold(500);
    await c.click($(p, '#btnRecord'), { steps: 12, settle: 200 });
    for (const k of ['a', 'd', 'g', 'k', 'g', 'd']) await c.key(k, 220);
    await c.pedal(true); await c.key('a', 200); await c.key('h', 200); await c.key('k', 300); await c.pedal(false);
    await c.run(1100, 160);
    await c.click($(p, '#btnStop'), { steps: 12, settle: 400 });
    await c.hold(900);
    await c.click($(p, '#songName'), { steps: 12, settle: 200 });
    await c.type('First meow');
    await p.keyboard.press('Enter'); await c.snap(300);
    await c.to($(p, '#btnPlay'), 12);
    await c.click(null, { settle: 100 }); await c.run(1600);
  },

  // SHARE copies a link; SAVE writes a MIDI file
  async share(c) {
    const p = c.page;
    await openApp(p);
    await p.setInputFiles('#midiFile', join(ROOT, 'songs/canon-in-d.mid')); await c.wait(300);
    await c.frame(); await c.hold(700);
    await c.click($(p, '#btnShare'), { steps: 14, settle: 300 });
    await c.hold(1600);
    await c.click($(p, '#btnSave'), { steps: 10, settle: 300 });
    await c.hold(1800);
  },

  // the sound: the settings panel, loop points, tuning
  async sound(c) {
    const p = c.page;
    await openApp(p); await c.frame(); await c.hold(500);
    await c.click($(p, '#btnLoopEdit'), { steps: 14, settle: 400 });
    await c.hold(700);
    const h = await $(p, '#handleEnd').boundingBox();
    await c.drag(h.x + h.width / 2, h.y + h.height / 2, h.x + h.width / 2 + 40, h.y + h.height / 2, 10);
    await c.key('g', 900);
    const t = await $(p, '#tuneSlider').boundingBox();
    const at = v => t.x + t.width * (v - 415) / 51;
    await c.drag(at(440), t.y + t.height / 2, at(432), t.y + t.height / 2, 10);
    await c.key('g', 900);
    await c.hold(800);
  },
};

const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const names = asked.length ? asked : Object.keys(CLIPS);
await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const name of names) {
    if (!CLIPS[name]) { console.log('no clip', name); continue; }
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, isMobile: PHONE, hasTouch: PHONE, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const c = new Clip(page);
    await CLIPS[name](c);
    await c.save(name);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
