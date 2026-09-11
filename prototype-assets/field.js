/* One pool, from sampled letter pixels to the persistent spatial field.
 * The solid raster and each departing tile come from the SAME glyph bitmap.
 * Content, scrolling and navigation never depend on this module succeeding.
 */
export function createField({ canvas, name, root, skip = false, onReady }) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const abort = new AbortController();
  const on = (el, event, fn) => el.addEventListener(event, fn, { signal: abort.signal, passive: true });
  const coarse = matchMedia('(pointer: coarse)');
  let width = 0, height = 0, ratio = 1, particles = [], bitmap = null;
  let frameId = 0, resizeTimer = 0, last = 0, elapsed = 0, lastDraw = 0;
  let speed = 1, fastForward = false, glyphRatio = 1;
  let disposed = false, paused = false, modal = false, hidden = document.hidden, ready = false;
  let intro = true, section = 'top', scroll = scrollY, geometry = 0, targetGeometry = 0;
  let ink = '', accent = '', origin = { x: 0, y: 0 }, glyphW = 0, glyphH = 0;
  let pointer = { x: -1000, y: -1000, lastMove: -10000 };
  let draws = 0, slowFrames = 0, lowPower = coarse.matches || (navigator.hardwareConcurrency || 8) <= 4;
  const HOLD = 1050, BREAK = 2450, END = HOLD + BREAK;
  const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
  const ease = t => t * t * (3 - 2 * t);
  let seed = 73199;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function refreshColour() {
    if (disposed) return;
    const style = getComputedStyle(root);
    ink = style.getPropertyValue('--color-ink').trim();
    accent = style.getPropertyValue('--color-accent').trim();
    if (bitmap && intro) rasterise(false);
    if (paused) draw(performance.now(), 0);
  }
  function size() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    ratio = intro ? Math.min(devicePixelRatio || 1, 3) : lowPower ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const rect = name.getBoundingClientRect();
    origin = { x: Math.round(rect.left * ratio) / ratio, y: Math.round((rect.top + scrollY) * ratio) / ratio };
  }
  function rasterise(rebuild = true) {
    const style = getComputedStyle(name);
    const rect = name.getBoundingClientRect();
    glyphW = Math.ceil(rect.width); glyphH = Math.ceil(rect.height);
    glyphRatio = Math.min(devicePixelRatio || 1, 3);
    const off = document.createElement('canvas');
    off.width = Math.ceil(glyphW * glyphRatio); off.height = Math.ceil(glyphH * glyphRatio);
    const c = off.getContext('2d', { willReadFrequently: true });
    if (!c) throw new Error('Glyph canvas unavailable');
    const fs = parseFloat(style.fontSize);
    c.scale(glyphRatio, glyphRatio);
    c.font = style.fontWeight + ' ' + fs + 'px ' + style.fontFamily;
    c.fontKerning = 'none';
    c.fillStyle = ink; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    // Read real DOM character positions and the actual inline baseline. This
    // also works where Canvas letterSpacing is absent or behaves differently.
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    name.append(marker);
    const baseline = marker.getBoundingClientRect().top - rect.top;
    marker.remove();
    const node = name.firstChild, range = document.createRange();
    for (let i = 0; i < node.textContent.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const charRect = range.getBoundingClientRect();
      c.fillText(node.textContent[i], charRect.left - rect.left, baseline);
    }
    bitmap = off;
    if (!rebuild) return;
    const data = c.getImageData(0, 0, off.width, off.height).data;
    const tile = 2;
    const sampled = [];
    seed = 73199;
    for (let y = 0; y < glyphH; y += tile) {
      for (let x = 0; x < glyphW; x += tile) {
        let occupied = false;
        for (let yy = Math.floor(y * glyphRatio); yy < Math.min((y + tile) * glyphRatio, off.height) && !occupied; yy++)
          for (let xx = Math.floor(x * glyphRatio); xx < Math.min((x + tile) * glyphRatio, off.width); xx++)
            if (data[(yy * off.width + xx) * 4 + 3] > 8) { occupied = true; break; }
        if (!occupied) continue;
        const nx = random(), ny = random(), depth = random();
        sampled.push({
          sx: x, sy: y, tile,
          x: origin.x + x, y: origin.y - scroll + y, vx: 0, vy: 0,
          nx, ny, depth, stable: random() < .2,
          phase: random() * Math.PI * 2,
          delay: (x / glyphW) * .26 + random() * .22,
          keep: random() < .4,
          r: .55 + depth * 1.1,
          accent: random() < .065
        });
      }
    }
    if (!sampled.length) throw new Error('Empty glyph raster');
    particles = sampled;
  }
  function markReady() {
    if (ready) return;
    ready = true; root.classList.add('field-ready'); onReady?.();
  }
  function finishIntro(instant = false) {
    if (!intro) return;
    if (!instant) {
      if (fastForward) return;
      fastForward = true;
      elapsed = Math.max(elapsed, HOLD);
      speed = Math.max(1, (END - elapsed) / 400);
      return;
    }
    intro = false;
    name.classList.add('in-canvas');
    particles = particles.filter(p => p.keep);
    particles.forEach(p => {
      const target = goal(p, elapsed / 1000);
      p.x = target.x; p.y = target.y; p.vx = 0; p.vy = 0;
    });
    size();
    markReady();
  }
  // A persistent identity and a persistent home for every surviving particle.
  // Half the field remains dispersed; the rest carries the section's geometry.
  function goal(p, time) {
    let x = p.nx * width, y = p.ny * height;
    if (!lowPower && p.nx > .48) {
      const angle = p.ny * Math.PI * 2;
      const arcX = width * .54 + Math.cos(angle) * width * (.25 + p.depth * .09);
      const arcY = height * .32 + Math.sin(angle) * height * (.1 + p.depth * .03) - Math.cos(angle) * height * .09;
      const lineX = width * (.08 + p.depth * .012);
      const lineY = p.ny * height;
      const gridX = width * (.54 + Math.floor(p.nx * 17) / 34);
      const gridY = height * (.12 + Math.floor(p.ny * 17) / 20);
      const stage = geometry;
      if (stage < 1) { x = arcX + (p.nx * width - arcX) * stage; y = arcY + (p.ny * height - arcY) * stage; }
      else if (stage < 2) { const a = stage - 1; x += (gridX - x) * a; y += (gridY - y) * a; }
      else if (stage < 3) { const a = stage - 2; x = gridX + (lineX - gridX) * a; y = gridY + (lineY - gridY) * a; }
      else if (stage < 4) { const a = stage - 3; x = lineX + (gridX - lineX) * a; y = lineY + (gridY - lineY) * a; }
      else { const a = clamp(stage - 4); x = gridX + (arcX - gridX) * a; y = gridY + (arcY - gridY) * a; }
    }
    const drift = lowPower ? 1.5 : 3;
    x += Math.sin(time * .16 + p.phase) * drift;
    y += Math.cos(time * .13 + p.phase) * drift;
    return { x, y };
  }
  function draw(now, dt) {
    ctx.clearRect(0, 0, width, height);
    const time = elapsed / 1000;
    const moving = clamp(1 - (now - pointer.lastMove) / 420);
    geometry += (targetGeometry - geometry) * Math.min(1, dt * .0025);
    if (intro && elapsed < HOLD) {
      return;
    }
    const progress = intro ? clamp((elapsed - HOLD) / BREAK) : 1;
    for (const p of particles) {
      const destination = goal(p, time);
      const release = ease(clamp((progress - p.delay) / (1 - p.delay)));
      const sourceX = origin.x + p.sx, sourceY = origin.y - scroll + p.sy;
      let gx = destination.x, gy = destination.y;
      if (intro) {
        gx = sourceX + (destination.x - sourceX) * release;
        gy = sourceY + (destination.y - sourceY) * release;
        // Each cell departs directly from its exact place in the bitmap.
        p.x = gx; p.y = gy;
      } else {
        const frame = Math.min(dt, 40) / 16.667;
        const damping = Math.pow(.85, frame);
        p.vx = (p.vx + (gx - p.x) * .023 * frame) * damping;
        p.vy = (p.vy + (gy - p.y) * .023 * frame) * damping;
        if (!p.stable && moving && !coarse.matches) {
          const dx = p.x - pointer.x, dy = p.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          const radius = 74;
          if (distance < radius && distance > .01) {
            const push = Math.pow(1 - distance / radius, 2) * moving * 2.2 * frame;
            p.vx += dx / distance * push; p.vy += dy / distance * push;
          }
        }
        p.x += p.vx * frame; p.y += p.vy * frame;
      }
      const finalAlpha = .09 + p.depth * .25;
      const alpha = intro ? (1 - release) + release * (p.keep ? finalAlpha : 0) : finalAlpha;
      if (alpha < .008) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.accent ? accent : ink;
      if (intro && release < .4) {
        const sw = Math.min(p.tile, glyphW - p.sx), sh = Math.min(p.tile, glyphH - p.sy);
        const scale = 1 - release * .6;
        ctx.drawImage(bitmap, p.sx * glyphRatio, p.sy * glyphRatio, sw * glyphRatio, sh * glyphRatio, p.x, p.y, sw * scale, sh * scale);
      } else {
        const r = p.r * (intro ? 1 + (1 - release) * .35 : 1);
        ctx.fillRect(p.x, p.y, r, r);
      }
    }
    ctx.globalAlpha = 1;
    // Hide crisp DOM only after its departing pixels have been painted.
    name.classList.add('in-canvas');
    if (intro && progress >= 1) {
      intro = false; particles = particles.filter(p => p.keep); markReady();
      size(); draw(now, 0);
    }
  }
  function frame(now) {
    frameId = 0;
    if (disposed || paused || modal || hidden) return;
    const delta = last ? Math.min(now - last, 50) : 16.667;
    last = now; elapsed += delta * (intro ? speed : 1);
    const interval = intro ? 0 : lowPower ? 50 : 32;
    if (now - lastDraw >= interval) {
      const drawDelta = lastDraw ? now - lastDraw : 16.667;
      const before = performance.now();
      try { draw(now, drawDelta); } catch { fail(); return; }
      const cost = performance.now() - before;
      if (cost > 18 && !intro) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 24 && !lowPower) { lowPower = true; size(); }
      lastDraw = now; draws++;
    }
    frameId = requestAnimationFrame(frame);
  }
  function run() {
    cancelAnimationFrame(frameId); frameId = 0; last = 0; lastDraw = 0;
    if (!disposed && !paused && !modal && !hidden) frameId = requestAnimationFrame(frame);
  }
  function setPaused(value) {
    if (disposed) return;
    paused = value;
    if (value) { finishIntro(true); draw(performance.now(), 0); }
    run();
  }
  function replay() {
    if (disposed) return;
    intro = true; ready = false; elapsed = 0; speed = 1; fastForward = false;
    name.classList.remove('in-canvas');
    root.classList.remove('field-ready');
    section = 'top'; geometry = targetGeometry = 0;
    scroll = scrollY; size(); rasterise(); draw(performance.now(), 0); run();
  }
  function destroy() {
    disposed = true; abort.abort(); cancelAnimationFrame(frameId); clearTimeout(resizeTimer);
    particles = []; bitmap = null;
    canvas.width = canvas.height = 1; canvas.hidden = true;
    name.classList.remove('in-canvas'); root.classList.remove('field-started');
    if (window.__portfolioField === api) delete window.__portfolioField;
  }
  function fail() {
    destroy();
    canvas.dispatchEvent(new Event('field-unavailable'));
  }
  on(window, 'pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (e.clientX === pointer.x && e.clientY === pointer.y) return;
    pointer = { x: e.clientX, y: e.clientY, lastMove: performance.now() };
  });
  on(canvas, 'contextlost', fail);
  on(document, 'pointerleave', () => { pointer.lastMove = -10000; });
  on(window, 'wheel', e => { if (!e.ctrlKey && Math.abs(e.deltaY) >= 8) finishIntro(); });
  on(window, 'keydown', e => { if (['Tab', 'Escape', 'PageDown', 'ArrowDown', ' '].includes(e.key)) finishIntro(); });
  on(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (disposed) return;
      if (coarse.matches && canvas.clientWidth === width && Math.abs(canvas.clientHeight - height) < 160) return;
      if (intro) finishIntro(); else size();
      if (paused) draw(performance.now(), 0);
    }, 120);
  });
  on(document, 'visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) finishIntro(true);
    run();
  });
  const api = {
    refreshColour, setPaused, replay, finishIntro, destroy,
    setModal(value) { modal = value; if (value) finishIntro(true); run(); },
    setScroll(y) { scroll = y; if (y > height * .3) finishIntro(); },
    setSection(value) {
      section = value;
      targetGeometry = ({ top: 0, about: 1, work: 2, projects: 2.2, experience: 3, capabilities: 4, contact: 5 })[value] ?? 0;
    },
    // Read-only diagnostics make continuity, timing and return testable.
    glyphPreview() {
      return bitmap ? { image: bitmap.toDataURL(), x: origin.x, y: origin.y - scroll,
        width: glyphW, height: glyphH, scale: glyphRatio } : null;
    },
    inspect() {
      return {
        intro, elapsed, ready, paused, modal, hidden, disposed, draws, section, geometry, lowPower,
        count: particles.length, survivors: particles.filter(p => p.keep).length,
        points: particles.slice(0, 180).map(p => ({ x: p.x, y: p.y, home: goal(p, elapsed / 1000), stable: p.stable }))
      };
    }
  };
  try {
    canvas.hidden = false;
    refreshColour(); size(); rasterise();
    const firstPaint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    elapsed = firstPaint ? Math.min(HOLD, Math.max(0, performance.now() - firstPaint)) : 0;
    if (skip) finishIntro(true);
    draw(performance.now(), 0);
    root.classList.add('field-started');
    if (skip) markReady();
    if (new URLSearchParams(location.search).has('debug')) window.__portfolioField = api;
    run();
  } catch (error) { destroy(); throw error; }
  return api;
}
