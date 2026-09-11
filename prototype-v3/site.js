/* chennxie.com prototype v3: page behaviour.
 * Content never depends on anything here succeeding: every hidden state has a
 * no-JS and reduced-motion path in the stylesheet, and the entrance has a
 * watchdog that always hands the page back.
 */
(function () {
  'use strict';
  var d = document, h = d.documentElement;
  var SELF = d.currentScript && d.currentScript.src;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(pointer: fine)').matches;
  var coarse = matchMedia('(pointer: coarse)').matches;
  var ac = new AbortController();
  function on(el, ev, fn, o) { el.addEventListener(ev, fn, Object.assign({ signal: ac.signal, passive: true }, o || {})); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  var motionOff = h.classList.contains('motion-off');
  var universe = null;

  /* ---------- smooth scroll (desktop only; phones keep native momentum) ---------- */
  var lenis = null;
  function startLenis() {
    if (lenis || reduce || coarse || motionOff || !window.Lenis) return;
    var own = lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    (function raf(t) { if (lenis !== own) return; own.raf(t); requestAnimationFrame(raf); })(performance.now());
  }
  function stopLenis() { if (!lenis) return; var l = lenis; lenis = null; l.destroy(); }
  startLenis();
  function scrollToEl(el) {
    if (lenis) lenis.scrollTo(el, { offset: -10 });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }
  $$('a[href^="#"]').forEach(function (a) {
    on(a, 'click', function (e) {
      var id = a.getAttribute('href'); if (id.length < 2) return;
      var el = d.querySelector(id); if (!el) return;
      e.preventDefault();
      closeMenu();
      scrollToEl(el);
      if (history.replaceState) history.replaceState(null, '', id);
      if (a.classList.contains('skip')) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    }, { passive: false });
  });

  /* ---------- mobile menu ---------- */
  var menuBtn = $('#menuBtn'), navLinks = $('#navLinks');
  function closeMenu() { if (!navLinks.classList.contains('open')) return; navLinks.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  on(menuBtn, 'click', function () {
    var open = !navLinks.classList.contains('open');
    navLinks.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { var f = navLinks.querySelector('a'); f && f.focus(); }
  });
  on(d, 'click', function (e) { if (!e.target.closest('.nav')) closeMenu(); });

  /* ---------- measured once, compared on scroll ---------- */
  var nav = $('.nav'), prog = $('.progress'), toTop = $('#toTop');
  var navSecs = $$('main section[id]');
  var links = $$('.nav-link');
  var formMap = { ring: 1, lattice: 2, line: 3, cluster: 4, logo: 5 };
  var secTops = [], pageH = 0, active = '', pastHero = false;
  var rvs = $$('.rv'), pend = reduce ? [] : rvs.slice(), rvTops = [];
  if (reduce) rvs.forEach(function (el) { el.classList.add('in'); });
  var visuals = $$('.case .visual'), visTops = [];
  var geo = null;

  function measure() {
    var y = window.scrollY || 0, vh = innerHeight;
    secTops = navSecs.map(function (s) { return [s.id, s.getBoundingClientRect().top + y]; });
    pageH = d.documentElement.scrollHeight - vh;
    rvTops = pend.map(function (el) { return el.getBoundingClientRect().top + y; });
    visTops = visuals.map(function (v) { var r = v.getBoundingClientRect(); return [r.top + y - (parseFloat(v.style.getPropertyValue('--py')) || 0), r.height]; });
    var list = [{ top: 0, scene: 0 }];
    $$('main [data-form]').forEach(function (s) { list.push({ top: s.getBoundingClientRect().top + y, scene: formMap[s.getAttribute('data-form')] || 0 }); });
    var m = $('#contactMark').getBoundingClientRect(), ax = $('#xpLine').getBoundingClientRect();
    geo = { list: list, mark: { x: m.left, top: m.top + y, w: m.width, h: m.height }, axis: ax.left + ax.width / 2 };
    if (universe) universe.setSections(geo.list, geo.mark, geo.axis);
  }
  function sweepRv(y) {
    if (!pend.length || rvTops.length !== pend.length) return;
    var line = y + innerHeight * 0.9, keep = [], tops = [];
    for (var i = 0; i < pend.length; i++) {
      if (rvTops[i] <= line) pend[i].classList.add('in'); else { keep.push(pend[i]); tops.push(rvTops[i]); }
    }
    pend = keep; rvTops = tops;
  }
  var parallaxOn = fine && !reduce;
  function parallax(y) {
    if (!parallaxOn || motionOff) return;
    var vh = innerHeight;
    for (var i = 0; i < visuals.length; i++) {
      var t = visTops[i]; if (!t) continue;
      var c = t[0] + t[1] / 2 - y - vh / 2;
      if (c < -vh * 1.2 || c > vh * 1.2) continue;
      visuals[i].style.setProperty('--py', (c * -0.05).toFixed(1) + 'px');
    }
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || 0;
      nav.classList.toggle('scrolled', y > 40);
      toTop.classList.toggle('show', y > innerHeight * 0.8);
      prog.style.transform = 'scaleX(' + (pageH > 0 ? Math.min(1, y / pageH) : 0).toFixed(4) + ')';
      var away = y > innerHeight;
      if (away !== pastHero) { pastHero = away; h.classList.toggle('past-hero', away); }
      sweepRv(y);
      parallax(y);
      var cur = '';
      for (var i = 0; i < secTops.length; i++) if (secTops[i][1] - y <= innerHeight * 0.4) cur = secTops[i][0];
      if (cur !== active) {
        active = cur;
        links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + cur); });
      }
    });
  }
  on(window, 'scroll', onScroll);
  var meT = 0;
  function remeasure() { clearTimeout(meT); meT = setTimeout(function () { measure(); onScroll(); }, 180); }
  on(window, 'resize', remeasure);
  on(window, 'load', remeasure);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(remeasure);
  if ('ResizeObserver' in window) { var ro = new ResizeObserver(remeasure); ro.observe(d.body); }
  measure(); onScroll();
  on(toTop, 'click', function () { if (lenis) lenis.scrollTo(0); else window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* ---------- covers only animate on screen ---------- */
  var covers = $$('.cover');
  if ('IntersectionObserver' in window && !reduce) {
    var io3 = new IntersectionObserver(function (en) { en.forEach(function (e) { e.target.classList.toggle('live', e.isIntersecting); }); }, { rootMargin: '200px 0px' });
    covers.forEach(function (el) { io3.observe(el); });
  } else covers.forEach(function (el) { el.classList.add('live'); });

  /* ---------- metric count-up ---------- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count')), suffix = el.getAttribute('data-suffix') || '';
    var sEl = el.querySelector('.s'), prefix = sEl ? sEl.outerHTML : '', dur = 1300, start = null;
    // hold the cell at its final width so the row doesn't shuffle while it counts
    var cell = el.closest('.metric');
    if (cell && !cell.style.minWidth) {
      cell.style.minWidth = Math.ceil(cell.getBoundingClientRect().width) + 'px';
      setTimeout(function () { cell.style.minWidth = ''; }, dur + 400);
    }
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.innerHTML = prefix + Math.round(target * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window && !reduce && !motionOff) {
    var io2 = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); } }); }, { threshold: 0.6 });
    $$('[data-count]').forEach(function (el) { io2.observe(el); });
  }

  /* ---------- experience: the row crossing the star lights up ---------- */
  var rows = $$('.tl-row'), xpNow = $('#xpNow'), star = $('.xp-star'), flip = false;
  function setRow(r) {
    rows.forEach(function (x) { x.classList.toggle('active', x === r); });
    var i = rows.indexOf(r) + 1;
    if (xpNow) xpNow.textContent = (i < 10 ? '0' : '') + i;
    flip = !flip; if (star) star.classList.toggle('spin', flip);
  }
  if ('IntersectionObserver' in window && !reduce) {
    var io4 = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) setRow(e.target); }); }, { rootMargin: '-50% 0px -50% 0px' });
    rows.forEach(function (r) { io4.observe(r); });
    setRow(rows[0]);
  } else rows.forEach(function (r) { r.classList.add('active'); });

  /* ---------- lightbox ---------- */
  var lb = $('#lb'), lbMain = $('#lbMain'), lbThumbs = $('#lbThumbs'), lbBody = $('#lbBody'), lbClose = $('#lbClose'), lbHint = $('#lbHint');
  var zoom = $('#zoom'), zoomImg = $('#zoomImg'), zoomClose = $('#zoomClose');
  var main = $('main'), opener = null, lbT = 0;
  function show(el) { el.hidden = false; void el.offsetWidth; el.classList.add('open'); }
  function hide(el, after) { el.classList.remove('open'); setTimeout(function () { if (!el.classList.contains('open')) { el.hidden = true; after && after(); } }, 420); }
  function openZoom(src, alt) { zoomImg.src = src; zoomImg.alt = alt || ''; show(zoom); zoomClose.focus(); }
  function closeZoom() { hide(zoom, function () { zoomImg.removeAttribute('src'); }); lbClose.focus(); }
  on(zoom, 'click', function (e) { if (e.target !== zoomImg) closeZoom(); });
  on(zoomClose, 'click', closeZoom);
  on(zoomImg, 'click', closeZoom);
  function openCase(caseEl, visual) {
    opener = visual;
    var title = caseEl.querySelector('h3').textContent;
    var sub = caseEl.querySelector('.case-sub');
    var more = caseEl.querySelector('.case-more');
    var media = more ? more.querySelector('.more-media') : null;
    var text = more ? more.querySelector('.more-text') : null;
    lbMain.innerHTML = ''; lbThumbs.innerHTML = ''; lbThumbs.hidden = true; lbHint.hidden = true;
    var imgs = media ? $$('img', media) : [];
    if (imgs.length) {
      var big = d.createElement('img'); big.src = imgs[0].getAttribute('src'); big.alt = imgs[0].alt; lbMain.appendChild(big);
      lbHint.hidden = false;
      big.addEventListener('click', function () { openZoom(big.src, big.alt); });
      if (imgs.length > 1) {
        lbThumbs.hidden = false;
        imgs.forEach(function (im, i) {
          var b = d.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Show ' + im.alt);
          if (i === 0) { b.className = 'sel'; b.setAttribute('aria-pressed', 'true'); } else b.setAttribute('aria-pressed', 'false');
          var t = d.createElement('img'); t.src = im.getAttribute('src'); t.alt = ''; b.appendChild(t);
          b.addEventListener('click', function () {
            big.src = t.src; big.alt = im.alt;
            [].forEach.call(lbThumbs.children, function (c) { c.className = ''; c.setAttribute('aria-pressed', 'false'); });
            b.className = 'sel'; b.setAttribute('aria-pressed', 'true');
          });
          lbThumbs.appendChild(b);
        });
      }
    } else {
      var graphic = visual.querySelector('.cover');
      if (graphic) { var g = graphic.cloneNode(true); g.classList.add('live'); lbMain.appendChild(g); }
    }
    var html = '<span class="kicker">Case study</span><h3></h3>' + (sub ? '<p class="lb-sub"></p>' : '');
    lbBody.innerHTML = html + (text ? text.innerHTML : '');
    lbBody.querySelector('h3').textContent = title;
    if (sub) lbBody.querySelector('.lb-sub').textContent = sub.textContent;
    lb.setAttribute('aria-label', title);
    lbBody.scrollTop = 0; lbMain.scrollTop = 0;
    clearTimeout(lbT);
    show(lb);
    main.inert = true; nav.inert = true;
    if (universe) universe.setPaused(true);
    if (lenis) lenis.stop();
    d.body.style.overflow = 'hidden';
    lbClose.focus();
  }
  function closeLB() {
    if (lb.hidden) return;
    if (!zoom.hidden) { zoom.classList.remove('open'); zoom.hidden = true; }
    hide(lb, function () { lbMain.innerHTML = ''; zoomImg.removeAttribute('src'); });
    main.inert = false; nav.inert = false;
    if (universe) universe.setPaused(false);
    if (lenis) lenis.start();
    d.body.style.overflow = '';
    if (opener) opener.focus({ preventScroll: true });
  }
  $$('.visual[data-open]').forEach(function (v) { on(v, 'click', function () { openCase(v.closest('.case'), v); }); });
  on(lbClose, 'click', closeLB);
  on(lb, 'click', function (e) { if (e.target === lb) closeLB(); });
  on(d, 'keydown', function (e) {
    if (e.key === 'Escape') {
      if (!zoom.hidden) closeZoom(); else if (!lb.hidden) closeLB(); else closeMenu();
      return;
    }
    if (e.key !== 'Tab') return;
    var box = !zoom.hidden ? zoom : !lb.hidden ? lb : null;
    if (!box) return;
    var f = $$('button,[href],[tabindex]:not([tabindex="-1"])', box).filter(function (x) { return !x.hidden && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  }, { passive: false });

  /* ---------- pointer details: cursor ring, metal highlight ---------- */
  if (fine && !reduce) {
    var ring = $('.cur-ring'), lab = $('.cur-label');
    var cx = -100, cy = -100, rx = -100, ry = -100, moving = 0;
    function loop() {
      rx += (cx - rx) * 0.22; ry += (cy - ry) * 0.22;
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      if (Math.abs(cx - rx) + Math.abs(cy - ry) > 0.3) moving = requestAnimationFrame(loop); else moving = 0;
    }
    on(window, 'mousemove', function (e) {
      cx = e.clientX; cy = e.clientY;
      if (!h.classList.contains('cursor-on') && !h.classList.contains('intro-on')) { rx = cx; ry = cy; h.classList.add('cursor-on'); }
      if (!moving) moving = requestAnimationFrame(loop);
    });
    on(d, 'mouseleave', function () { h.classList.remove('cursor-on'); });
    $$('a,button').forEach(function (el) {
      on(el, 'mouseenter', function () { ring.classList.add('hov'); });
      on(el, 'mouseleave', function () { ring.classList.remove('hov'); });
    });
    $$('.visual.clickable').forEach(function (el) {
      var cta = el.getAttribute('data-cta') || 'View';
      on(el, 'mouseenter', function () { ring.classList.add('view'); lab.textContent = cta; });
      on(el, 'mouseleave', function () { ring.classList.remove('view'); });
    });
    $$('.btn').forEach(function (b) {
      on(b, 'pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.setProperty('--hx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        b.style.setProperty('--hy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
      on(b, 'pointerleave', function () { b.style.removeProperty('--hx'); b.style.removeProperty('--hy'); });
    });
  }

  /* ---------- chrome title: one reflection after the entrance, again on hover ---------- */
  var titles = $$('.metal');
  function shine(el) {
    if (reduce || motionOff || el.classList.contains('shine')) return;
    el.classList.add('shine');
  }
  titles.forEach(function (t) {
    on(t, 'animationend', function () { t.classList.remove('shine'); });
    if (fine) on(t, 'mouseenter', function () { shine(t); });
  });
  var contactBig = $('.contact-big');
  if ('IntersectionObserver' in window) {
    var io5 = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) { setTimeout(function () { shine(e.target); }, 500); io5.unobserve(e.target); } }); }, { threshold: 0.6 });
    io5.observe(contactBig);
  }

  /* ---------- motion switch (WCAG 2.2.2) ---------- */
  var motionBtn = $('#motionBtn');
  function paintMotion() { motionBtn.textContent = motionOff ? 'Resume motion' : 'Pause motion'; motionBtn.setAttribute('aria-pressed', String(motionOff)); }
  paintMotion();
  on(motionBtn, 'click', function () {
    motionOff = !motionOff;
    h.classList.toggle('motion-off', motionOff);
    try { localStorage.setItem('ce_motion', motionOff ? 'off' : 'on'); } catch (e) { /* private mode */ }
    paintMotion();
    if (universe) universe.setStill(motionOff);
    if (motionOff) { stopLenis(); visuals.forEach(function (v) { v.style.removeProperty('--py'); }); }
    else startLenis();
  });

  /* ---------- entrance ---------- */
  var intro = $('#intro'), introName = $('#introName'), role = $('.intro-role'), quote = $('.intro-quote'), bar = $('.intro-prog i');
  var playing = h.classList.contains('intro-on');
  var T = { type1: [0.35, 1.55], type2: [1.6, 3.15], qOut: [4.7, 5.2], conv: [4.8, 5.9], nameIn: [5.45, 5.9], roleIn: [5.7, 6.15], brk: 6.9, brkDur: 2.45, roleOut: [6.75, 7.05], reveal: 8.2 };
  var state = { t0: null, T: T, done: false };
  var revealed = !playing, finished = !playing, skipped = false, nameGone = false, watchdog = 0;
  var lines = $$('.ql-v').map(function (el) {
    var txt = el.getAttribute('data-text') || '', frag = d.createDocumentFragment(), spans = [];
    for (var i = 0; i < txt.length; i++) {
      if (txt[i] === ' ') { frag.appendChild(d.createTextNode(' ')); spans.push(null); continue; }
      var s = d.createElement('span'); s.className = 'c'; s.textContent = txt[i]; frag.appendChild(s); spans.push(s);
    }
    el.appendChild(frag);
    return { spans: spans, n: 0 };
  });
  function seg(t, r) { return Math.max(0, Math.min(1, (t - r[0]) / (r[1] - r[0]))); }
  function typeTo(line, k) {
    var n = Math.round(line.spans.length * k);
    if (n === line.n) return;
    for (var i = Math.min(n, line.n); i < Math.max(n, line.n); i++) if (line.spans[i]) line.spans[i].classList.toggle('on', i < n);
    line.n = n;
  }
  function reveal() {
    if (revealed) return;
    revealed = true;
    h.classList.add('revealing');
    h.classList.remove('intro-on');
    try { sessionStorage.setItem('ce_intro_seen', '1'); } catch (e) { /* private mode */ }
    setTimeout(function () { h.classList.remove('revealing'); shine($('#heroTitle')); }, 1400);
    measure(); onScroll();
  }
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    reveal();
    if (universe) universe.finishNow();
  }
  function skip() {
    if (skipped || finished) return;
    skipped = true;
    var now = performance.now();
    if (universe && state.t0 != null) universe.skip(now);
    quote.style.transition = 'opacity .25s'; quote.style.opacity = '0';
    introName.style.transition = 'opacity .3s'; introName.style.opacity = '0';
    role.style.transition = 'opacity .25s'; role.style.opacity = '0';
    intro.classList.add('leaving');
    reveal();
    setTimeout(finish, 1100);
  }
  function tick(now) {
    if (finished) return;
    var t = (now - state.t0) / 1000;
    if (!skipped) {
      typeTo(lines[0], seg(t, T.type1));
      typeTo(lines[1], seg(t, T.type2));
      quote.style.opacity = (1 - seg(t, T.qOut)).toFixed(3);
      if (t < T.brk) introName.style.opacity = seg(t, T.nameIn).toFixed(3);
      else if (!nameGone) {
        nameGone = true;
        // the canvas now carries the exact glyph tiles; drop the DOM copy in the same frame
        if (universe && universe.tilesReady) { introName.style.opacity = '1'; introName.classList.add('gone'); }
        else { introName.style.transition = 'opacity .9s, filter .9s'; introName.style.opacity = '0'; introName.style.filter = 'blur(6px)'; }
      }
      role.style.opacity = (seg(t, T.roleIn) * (1 - seg(t, T.roleOut))).toFixed(3);
      bar.style.transform = 'scaleX(' + Math.min(1, t / (T.brk + T.brkDur)).toFixed(3) + ')';
      if (t >= T.reveal) { intro.classList.add('leaving'); reveal(); }
    }
    if (state.done || t > T.brk + T.brkDur + 0.3) { finish(); return; }
    requestAnimationFrame(tick);
  }
  function startIntro() {
    if (state.t0 != null || finished) return;
    state.t0 = performance.now();
    if (universe) universe.start();
    requestAnimationFrame(tick);
  }
  if (playing) {
    watchdog = setTimeout(finish, 13000);
    on(intro, 'click', skip);
    on($('#introSkip'), 'click', function (e) { e.stopPropagation(); skip(); });
    on(window, 'wheel', function (e) { if (Math.abs(e.deltaY) > 4) skip(); });
    on(window, 'touchmove', skip);
    on(window, 'keydown', function (e) { if (['Tab', 'Escape', 'Enter', ' ', 'ArrowDown', 'PageDown', 'End'].indexOf(e.key) > -1) skip(); });
    on(window, 'scroll', function () { if ((window.scrollY || 0) > 10) skip(); });
    on(d, 'visibilitychange', function () { if (d.hidden) { skip(); finish(); } });
    on(window, 'pageshow', function (e) { if (e.persisted && !finished) { skip(); finish(); } });
    // don't wait on webfonts for long: the name is sampled from real glyphs later anyway
    var started = false, go = function () { if (!started) { started = true; startIntro(); } };
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(go);
    setTimeout(go, 900);
  } else if (!reduce) {
    setTimeout(function () { shine($('#heroTitle')); }, 900);
  }

  /* ---------- the universe (skipped entirely under reduced motion) ---------- */
  function tierOf() {
    var cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    if (cores < 4 || mem < 4) return 'low';
    if (coarse || innerWidth < 700) return 'mid';
    return 'high';
  }
  function boot() {
    var url = SELF ? new URL('universe.js', SELF).href : 'prototype-v3/universe.js';
    import(url).then(function (mod) {
      var t = tierOf(), front = null;
      if (t === 'high') {
        front = d.createElement('canvas');
        front.className = 'universe-front'; front.setAttribute('aria-hidden', 'true'); front.hidden = true;
        d.body.appendChild(front);
      }
      var logo = $('#logo-mark');
      universe = mod.createUniverse({
        back: $('#universe'), front: front, tier: t,
        intro: playing && !finished && !skipped ? state : null,
        nameEl: introName,
        logoPath: logo ? logo.getAttribute('d') : '',
        onForm: function (v) { h.classList.toggle('gl-form', v); }
      });
      if (geo) universe.setSections(geo.list, geo.mark, geo.axis);
      if (motionOff) universe.setStill(true);
      h.classList.add('gl-on');
      universe.start();
      if (new URLSearchParams(location.search).has('debug')) { window.__universe = universe; window.__intro = state; }
    }).catch(function (err) {
      h.classList.remove('gl-on');
      if (window.console && /debug/.test(location.search)) console.warn('universe unavailable', err);
    });
  }
  if (!reduce) boot();

  /* bfcache and unload: give GPU memory back */
  on(window, 'pagehide', function (e) { if (!e.persisted && universe) { universe.destroy(); universe = null; } });
})();
