// SPDX-License-Identifier: MIT OR Apache-2.0
// Text as frosted glass: dark glass with brushed streaks, bright icy rims with a soft bloom, and
// small silver particles rising inside the letters. Drawn on a canvas
// laid over the element's own text (which stays, transparent, for layout and screen readers). The
// glass is drawn once per size; each frame only adds the particles, clipped to the
// letters. Used by the What's new tour for its "0.5".
//
//   const stop = iceText(span);   // later: stop()

const PAD = 36; // room around the text for the bloom (CSS px)

/** A particle's glow, drawn once: a bright silver core fading to clear ice blue. */
const SPARK = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(245, 252, 255, 1)');
  grad.addColorStop(0.35, 'rgba(200, 235, 255, 0.55)');
  grad.addColorStop(1, 'rgba(160, 220, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
})();

/** Starts the effect on `el` (its text, font and size); returns a function that stops it. */
export function iceText(el) {
  const text = el.textContent;
  const canvas = document.createElement('canvas');
  canvas.className = 'ice-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  el.append(canvas);
  const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let glass = null; // the drawn glass, rims and bloom
  let mask = null; // the letters, opaque
  let dots = null; // scratch layer for the particles
  let particles = [];
  let size = { w: 0, h: 0, dpr: 1, font: '', baseline: 0, x: 0, fontSize: 0 };
  let raf = 0;
  let stopped = false;
  let shown = false;
  const started = performance.now();

  /** Lays the canvas over the text and draws everything that doesn't move. */
  function layout() {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!rect.width) return false;
    const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const fontSize = parseFloat(cs.fontSize);
    // getBoundingClientRect includes any transform (the tour's entrance animation): use the layout size.
    const w = el.offsetWidth + 2 * PAD;
    const h = el.offsetHeight + 2 * PAD;
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (w === size.w && h === size.h && font === size.font && dpr === size.dpr) return true;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${-PAD}px`;
    canvas.style.top = `${-PAD}px`;
    const make = () => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = font;
      if ('letterSpacing' in g) g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      g.textBaseline = 'alphabetic';
      return [c, g];
    };
    // Where the browser puts the baseline in this line box (half-leading above the font's ascent).
    const [m, mg] = make();
    const metrics = mg.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.9;
    const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.22;
    const lineHeight = el.offsetHeight;
    const baseline = PAD + (lineHeight - (ascent + descent)) / 2 + ascent;
    const x = PAD + (parseFloat(cs.paddingLeft) || 0);
    size = { w, h, dpr, font, baseline, x, fontSize };
    mg.fillStyle = '#fff';
    mg.fillText(text, x, baseline);
    mask = m;
    glass = drawGlass(make, text, size, mask);
    dots = make()[0];
    seed();
    return true;
  }

  /** Particles spread through the letters' box, each with its own speed, size and twinkle. */
  function seed() {
    const n = Math.round(Math.max(70, Math.min(260, (size.w * size.h) / 420)));
    particles = Array.from({ length: n }, () => ({
      x: PAD + Math.random() * (size.w - 2 * PAD),
      y: Math.random() * size.h,
      r: 0.35 + Math.random() ** 3 * 1.2,
      v: 7 + Math.random() * 18, // px per second, upward
      sway: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      rate: 1.5 + Math.random() * 3,
    }));
  }

  function frame(now) {
    if (stopped) return;
    // Gone from the page (the tour moved on or closed): stop. Not there yet: wait for it.
    if (!el.isConnected) {
      if (shown) return stop();
      raf = requestAnimationFrame(frame);
      return;
    }
    shown = true;
    if (!layout()) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const t = (now - started) / 1000;
    const { h, dpr } = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(glass, 0, 0);
    // Particles, kept inside the letters.
    const d = dots.getContext('2d');
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, dots.width, dots.height);
    d.setTransform(dpr, 0, 0, dpr, 0, 0);
    // One pre-drawn glow, stamped per particle (no gradients built per frame).
    for (const p of particles) {
      const y = ((((p.y - p.v * t) % h) + h) % h);
      const x = p.x + Math.sin(t * 0.7 + p.sway) * 2.2;
      d.globalAlpha = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * p.rate + p.phase)) ** 3;
      const r = p.r * 3;
      d.drawImage(SPARK, x - r, y - r, r * 2, r * 2);
    }
    d.globalAlpha = 1;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'destination-in';
    d.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(dots, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (!still) raf = requestAnimationFrame(frame);
  }

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    canvas.remove();
    el.classList.remove('ice-live');
  }

  const observer = new ResizeObserver(() => {
    if (still && !stopped) requestAnimationFrame(frame);
  });
  observer.observe(el);
  el.classList.add('ice-live');
  // Draw once the font is in, so the canvas letters match the page's.
  (document.fonts?.ready ?? Promise.resolve()).then(() => {
    if (!stopped) raf = requestAnimationFrame(frame);
  });
  return stop;
}

/** The parts that don't move: dark glass, brushed streaks, the inner edge light, rims and bloom. */
function drawGlass(make, text, { w, h, x, baseline, fontSize }, mask) {
  const [c, g] = make();
  const top = baseline - fontSize * 0.75;
  // Glass: deep teal, lighter through the middle.
  const fill = g.createLinearGradient(0, top, 0, baseline);
  fill.addColorStop(0, 'rgba(60, 108, 136, 0.62)');
  fill.addColorStop(0.45, 'rgba(14, 34, 48, 0.55)');
  fill.addColorStop(0.7, 'rgba(30, 66, 88, 0.6)');
  fill.addColorStop(1, 'rgba(10, 26, 38, 0.7)');
  g.fillStyle = fill;
  g.fillText(text, x, baseline);
  // Brushed streaks across the glass, only where there are letters.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 110; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const len = fontSize * (0.15 + rand() * 0.6);
    const ang = -1.1 + (rand() - 0.5) * 0.25;
    g.strokeStyle = `rgba(${rand() < 0.6 ? '215, 240, 255' : '120, 190, 225'}, ${0.03 + rand() ** 2 * 0.3})`;
    g.lineWidth = 0.4 + rand() * 1.1;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    g.stroke();
  }
  // The inner edge lights up, like a bevel catching the light.
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(150, 215, 245, 0.3)';
  g.lineWidth = fontSize * 0.045;
  g.strokeText(text, x, baseline);
  g.strokeStyle = 'rgba(235, 250, 255, 0.5)';
  g.lineWidth = fontSize * 0.016;
  g.strokeText(text, x, baseline);
  g.restore();
  // Rims: a wide soft bloom outside, then a fine bright line.
  g.save();
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(110, 200, 245, 0.85)';
  g.shadowBlur = fontSize * 0.16;
  g.strokeStyle = 'rgba(150, 215, 245, 0.35)';
  g.lineWidth = Math.max(2, fontSize * 0.022);
  g.strokeText(text, x, baseline);
  g.shadowBlur = fontSize * 0.05;
  g.shadowColor = 'rgba(190, 235, 255, 0.9)';
  g.strokeStyle = 'rgba(235, 250, 255, 0.95)';
  g.lineWidth = Math.max(1, fontSize * 0.009);
  g.strokeText(text, x, baseline);
  g.restore();
  return c;
}
