/* chennxie.com prototype v3: page behaviour.
 * Content never depends on anything here succeeding: every hidden state has a
 * no-JS and reduced-motion path in the stylesheet, and the entrance has a
 * watchdog that always hands the page back.
 */
(function () {
  'use strict';
  var d = document, h = d.documentElement;
  var SELF = d.currentScript && d.currentScript.src;
  var mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = mqReduce.matches;
  var fine = matchMedia('(pointer: fine)').matches;
  var coarse = matchMedia('(pointer: coarse)').matches;
  var ac = new AbortController();
  function on(el, ev, fn, o) { el.addEventListener(ev, fn, Object.assign({ signal: ac.signal, passive: true }, o || {})); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  function afterFirstFrame(fn) { requestAnimationFrame(function () { setTimeout(fn, 0); }); }
  var motionOff = h.classList.contains('motion-off');
  /* The head failsafe gave up on us (slow network) and showed the plain page.
     Rejoin the enhanced page in one step: everything already on show stays on
     show, and the entrance does not start late. */
  var rejoined = h.classList.contains('no-js');
  if (rejoined) { h.classList.remove('no-js'); h.classList.add('js'); }
  var universe = null;

  /* ---------- smooth scroll (desktop only; phones keep native momentum) ---------- */
  var lenis = null;
  var LENIS = { src: 'https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js', sri: 'sha384-O55L/6rhHr9CFvrxqv5luxOCcmVaBmETbZbJDP+Do8T0pztTACsFBD/IXCNkj7DV' };
  /* loaded here, after the page works, so a slow or failed CDN can't hold anything up */
  function loadLenis() {
    if (reduce || coarse || motionOff) return;
    if (playing && !revealed) return;   // nothing to scroll behind the entrance, and it would animate scrollTo
    if (window.Lenis) return startLenis();
    if (d.getElementById('lenisJs')) return;
    var sc = d.createElement('script');
    sc.id = 'lenisJs'; sc.src = LENIS.src; sc.integrity = LENIS.sri; sc.crossOrigin = 'anonymous'; sc.async = true;
    sc.onload = startLenis;
    d.head.appendChild(sc);
  }
  function startLenis() {
    if (lenis || reduce || coarse || motionOff || !window.Lenis) return;
    var own;
    try { own = lenis = new Lenis({ lerp: 0.1, smoothWheel: true }); } catch (e) { lenis = null; return; }
    if (lbOpen) own.stop();   // arrived while a dialog is up
    (function raf(t) { if (lenis !== own) return; own.raf(t); requestAnimationFrame(raf); })(performance.now());
  }
  function stopLenis() { if (!lenis) return; var l = lenis; lenis = null; l.destroy(); }
  // started from applyStill() at the end of this file, once playing/revealed are known
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
  var formMap = { ring: 1, lattice: 2, helix: 3, line: 4, cluster: 5, logo: 6 };
  var secTops = [], pageH = 0, active = '', pastHero = false;
  var rvs = $$('.rv'), pend = reduce || rejoined ? [] : rvs.slice(), rvTops = [];
  if (reduce || rejoined) rvs.forEach(function (el) { el.classList.add('in'); });
  var visuals = $$('.case .visual'), visTops = [];
  var rows = $$('.tl-row'), rowTops = [], rowNow = null;
  var geo = null;

  /* Every heading has --pad of air under the content above it plus its own band (Mark,
     2026-09-13: match Side Projects). A case or a grid ends where its content ends, but the
     last Experience row centres its text in the row's min-height, so the row runs on below
     the text by an amount that depends on the text. Measure that slack and set the section's
     bottom margin so exactly --pad is left under the last line (negative on desktop, where
     the slack is larger; positive on phones, where the rows have no min-height). */
  var xpSec = $('#experience'), padRef = $('.caps');
  function tailXp() {
    var last = rows[rows.length - 1];
    if (!last || !xpSec || !padRef) return;
    var ink = -Infinity;
    for (var k = 0; k < last.children.length; k++) ink = Math.max(ink, last.children[k].getBoundingClientRect().bottom);
    var fix = (parseFloat(getComputedStyle(padRef).paddingTop) || 0) - (last.getBoundingClientRect().bottom - ink);
    if (Math.abs(fix - (parseFloat(xpSec.style.marginBottom) || 0)) > 0.5) xpSec.style.marginBottom = fix.toFixed(1) + 'px';
  }

  function measure() {
    tailXp();
    var y = window.scrollY || 0, vh = innerHeight;
    secTops = navSecs.map(function (s) { return [s.id, s.getBoundingClientRect().top + y]; });
    pageH = d.documentElement.scrollHeight - vh;
    rvTops = pend.map(function (el) { return el.getBoundingClientRect().top + y; });
    visTops = visuals.map(function (v) { var r = v.getBoundingClientRect(); return [r.top + y - (parseFloat(v.style.getPropertyValue('--py')) || 0), r.height]; });
    var list = [{ top: 0, scene: 0 }];
    $$('main [data-form]').forEach(function (s) { list.push({ top: s.getBoundingClientRect().top + y, scene: formMap[s.getAttribute('data-form')] || 0 }); });
    rowTops = rows.map(function (r) { var b = r.getBoundingClientRect(); return [b.top + y, b.height]; });
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
  function parallax(y) {
    if (!fine || reduce || motionOff) return;
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
      // the row whose box spans the viewport centre is the one under the star
      var c = y + innerHeight / 2, hit = null;
      for (var j = 0; j < rowTops.length; j++) if (c >= rowTops[j][0] && c < rowTops[j][0] + rowTops[j][1]) hit = rows[j];
      if (!hit && rowTops.length) hit = c < rowTops[0][0] ? rows[0] : c >= rowTops[rowTops.length - 1][0] ? rows[rows.length - 1] : rowNow;
      if (hit && hit !== rowNow) setRow(hit);
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
  // Everything that reads layout waits for the first frame. Even touching
  // document.fonts.ready forces style and layout, which would pull the whole
  // page's first layout into this script task and hold back the first paint.
  afterFirstFrame(function () {
    measure(); onScroll();
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { remeasure(); if (universe && !finished && state.t0 != null) universe.fontsChanged(); });
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(remeasure); ro.observe(d.body); }
  });
  /* ---------- no stub lines: text never ends on a short line ----------
     Mark's rule (2026-09-13): a last line of four words or fewer joins the line above.
     Tried in order, least visible first, and the first that works is kept:
       1. widen the text box, up to what its container allows, to the narrowest width
          that takes the short line up into the one above;
       2. let the browser re-break the last lines (text-wrap: pretty, no width change);
       3. balance the lines (browsers balance at most six);
       4. narrow the box (up to 30%, same number of lines) so words come down to join it;
       5. take a hair off the word spacing so the short line fits up into the one above;
       6. narrow on, accepting one more line, then two, until the last line is long enough.
     If none of those works the text is left exactly as the stylesheet set it.
     "Short" is four words or fewer that also reach less than two thirds of the widest
     line. On desktop every four-word last line is well under that; the width test only
     matters on phones, where a column holds four long words edge to edge ("reporting to
     C-suite stakeholders.") and no width would ever put five on the last line.
     Headings, labels and the footer lines are balanced in the stylesheet, and come
     through here too, for the cases balancing leaves one word on its own ("Product
     Operations / Specialist"). Two-word section titles are left alone: any break in them
     is one word a line. It runs in idle slices once the webfonts settle, again whenever
     a batch of fonts lands or the width changes, and never from its own ResizeObserver,
     which it would feed. */
  var PROSE = '.about-copy p, .princ p, .case-lead, .case-notes p, .metrics-note, .sec-note, .tl-note, .princ h4, .case h3, .case-sub, .tl-what h3, .tl-where, .cap li, .lede-copy, .foot-avail > span';
  var stubRange = d.createRange(), stubQ = [], stubBusy = false, stubW = -1;
  function tailOf(el) {
    var nodes = [], text = '', n, w = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while ((n = w.nextNode())) { nodes.push([n, text.length]); text += n.textContent; }
    var words = [], re = /\S+/g, m;
    // across <b> and the "." after it the characters still run on: one word, not two
    while ((m = re.exec(text))) words.push([m.index, m.index + m[0].length - 1]);
    if (words.length < 2) return { lines: 1, last: words.length, fill: 1 };
    var rect = null;
    function top(pos) {
      for (var i = nodes.length - 1; i > 0; i--) if (nodes[i][1] <= pos && pos < nodes[i][1] + nodes[i][0].length) break;
      stubRange.setStart(nodes[i][0], pos - nodes[i][1]); stubRange.setEnd(nodes[i][0], pos - nodes[i][1] + 1);
      rect = stubRange.getClientRects()[0] || stubRange.getBoundingClientRect();
      return rect.top;
    }
    var lh = parseFloat(getComputedStyle(el).lineHeight) || 20, left = el.getBoundingClientRect().left;
    // a word's LAST character decides its line: "editor-day." may break at the hyphen
    var lastTop = top(words[words.length - 1][1]), right = rect.right;
    var lines = Math.round((lastTop - top(words[0][0])) / lh) + 1, last = 1;
    for (var k = words.length - 2; k >= 0 && last < 6; k--) { if (Math.abs(top(words[k][1]) - lastTop) < lh / 2) last++; else break; }
    stubRange.selectNodeContents(el);
    var widest = 0, all = stubRange.getClientRects();
    for (var j = 0; j < all.length; j++) widest = Math.max(widest, all[j].right - left);
    return { lines: lines, last: last, fill: widest > 0 ? +((right - left) / widest).toFixed(3) : 1 };
  }
  function isStub(r) { return r.lines > 1 && r.last <= 4 && r.fill < 0.66; }
  function unstub(el) {
    var st = el.style;
    st.maxWidth = ''; st.wordSpacing = ''; st.textWrap = '';
    if (!el.isConnected || !el.getClientRects().length || getComputedStyle(el).whiteSpace === 'nowrap') return;
    var t = tailOf(el);
    if (!isStub(t)) return;
    var cur = el.offsetWidth, p = el.parentElement, pcs = getComputedStyle(p);
    var room = Math.floor(p.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight));
    function at(px, ws, wrap) { st.maxWidth = px ? px + 'px' : ''; st.wordSpacing = ws ? ws + 'em' : ''; st.textWrap = wrap || ''; return tailOf(el); }
    var r, k, j;
    if (room > cur + 1 && at(room).lines < t.lines) {                                                                   // 1
      var lo = cur, hi = room;
      while (hi - lo > 2) { var mid = (lo + hi) / 2; if (at(mid).lines < t.lines) hi = mid; else lo = mid; }
      if (!isStub(at(Math.ceil(hi)))) return;
    }
    if (CSS.supports('text-wrap', 'pretty') && !isStub(at(0, 0, 'pretty'))) return;                                       // 2
    if (t.lines <= 6 && !isStub(at(0, 0, 'balance'))) return;                                                              // 3
    for (k = 1; k <= 30; k++) { r = at(Math.floor(cur * (1 - k / 100))); if (r.lines > t.lines) break; if (!isStub(r)) return; }   // 4
    for (j = 1; j <= 4; j++) { r = at(0, -0.01 * j); if (r.lines <= t.lines && !isStub(r)) return; }                         // 5
    for (j = 1; j <= 2; j++)                                                                                                // 6
      for (; k <= 30; k++) { r = at(Math.floor(cur * (1 - k / 100))); if (r.lines > t.lines + j) break; if (!isStub(r)) return; }
    // nothing within those limits clears the rule (a long paragraph in a phone column):
    // keep the browser's own re-break if it at least takes the line from one word to more
    if (CSS.supports('text-wrap', 'pretty')) { r = at(0, 0, 'pretty'); if (r.lines === t.lines && r.last > t.last) return; }
    at(0, 0, '');
  }
  function queueUnstub(list, after) {
    list.forEach(function (el) { if (stubQ.indexOf(el) < 0) stubQ.push(el); });
    if (stubBusy) return;
    stubBusy = true;
    (function slice() {
      var t0 = performance.now();
      // the width moved while the queue was still running: whatever this slice fits is fitted
      // to the new width, so the pass is stale even if the window comes back to where it was
      // before the resize settles. Forget the width and the settled resize redoes it all.
      if (stubQ.length && innerWidth !== stubW) stubW = -1;
      while (stubQ.length && performance.now() - t0 < 8) unstub(stubQ.shift());
      if (stubQ.length) return (window.requestIdleCallback || setTimeout)(slice, { timeout: 400 });
      stubBusy = false;
      if (after) after();
    })();
  }
  function unstubPage() {
    if (innerWidth === stubW) return;
    stubW = innerWidth;
    // an open case dialog re-breaks too: its paragraphs were fitted when it opened, and a
    // resize or a late font changes them just as it does the page's
    queueUnstub($$(PROSE).concat(lbOpen ? $$('p', lbBody) : []), remeasure);
  }
  afterFirstFrame(function () {
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { (window.requestIdleCallback || setTimeout)(unstubPage, { timeout: 600 }); });
    else unstubPage();
  });
  // fonts.ready can settle before a webfont has even started to load (a face is fetched
  // only once some text needs it), so the pass above may have measured fallback glyphs.
  // Every webfont moves the line breaks: measure again whenever a batch of fonts lands.
  var stubFonts = 0;
  if (d.fonts && 'onloadingdone' in d.fonts) on(d.fonts, 'loadingdone', function () { clearTimeout(stubFonts); stubFonts = setTimeout(function () { stubW = -1; unstubPage(); }, 120); });
  var stubRz = 0;
  on(window, 'resize', function () { clearTimeout(stubRz); stubRz = setTimeout(unstubPage, 220); });
  if (new URLSearchParams(location.search).has('debug')) window.__unstub = { tailOf: tailOf, isStub: isStub, run: function () { stubW = -1; unstubPage(); }, busy: function () { return stubBusy; } };

  on(toTop, 'click', function () { if (lenis) lenis.scrollTo(0); else window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* ---------- covers only animate on screen ---------- */
  var covers = $$('.cover');
  if ('IntersectionObserver' in window && !reduce) {
    var io3 = new IntersectionObserver(function (en) { en.forEach(function (e) { e.target.classList.toggle('live', e.isIntersecting); }); }, { rootMargin: '200px 0px' });
    covers.forEach(function (el) { io3.observe(el); });
  } else covers.forEach(function (el) { el.classList.add('live'); });

  /* ---------- metric count-up ---------- */
  function countUp(el) {
    if (reduce || motionOff) return;   // the final figure is already in the markup
    var target = parseFloat(el.getAttribute('data-count')), suffix = el.getAttribute('data-suffix') || '';
    var sEl = el.querySelector('.s'), prefix = sEl ? sEl.outerHTML : '', dur = 1300, start = null;
    // hold the cell at its final width so the row doesn't shuffle while it counts
    var cell = el.closest('.metric');
    if (cell && !cell.style.minWidth) {
      cell.style.minWidth = Math.ceil(cell.getBoundingClientRect().width) + 'px';
      setTimeout(function () { cell.style.minWidth = ''; }, dur + 400);
    }
    function step(ts) {
      if (reduce || motionOff) { el.innerHTML = prefix + target + suffix; return; }   // motion stopped mid-count
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
  var xpNow = $('#xpNow'), star = $('.xp-star'), turn = 0;
  function setRow(r) {
    var prev = rowNow == null ? -1 : rows.indexOf(rowNow);
    rowNow = r;
    rows.forEach(function (x) { x.classList.toggle('active', x === r); });
    var i = rows.indexOf(r) + 1;
    if (xpNow) xpNow.textContent = (i < 10 ? '0' : '') + i;
    // the star turns with the reading: clockwise on to a later role, anticlockwise back
    // to an earlier one (Mark, 2026-09-13). The angle accumulates, so every step turns
    // a quarter the right way instead of unwinding.
    if (prev > -1 && star) { turn += i - 1 > prev ? 90 : -90; star.style.setProperty('--turn', turn + 'deg'); }
  }
  if (!rowNow) setRow(rows[0]);

  /* ---------- lightbox ---------- */
  var lb = $('#lb'), lbMain = $('#lbMain'), lbThumbs = $('#lbThumbs'), lbBody = $('#lbBody'), lbClose = $('#lbClose'), lbHint = $('#lbHint');
  var zoom = $('#zoom'), zoomImg = $('#zoomImg'), zoomClose = $('#zoomClose');
  var main = $('main'), opener = null, zoomOpener = null, lbOpen = false, zoomOpen = false;
  // open/closed is state; the fade is only the picture of it
  function show(el) { el.hidden = false; void el.offsetWidth; el.classList.add('open'); }
  function hide(el, after) { el.classList.remove('open'); setTimeout(function () { if (!el.classList.contains('open')) { el.hidden = true; after && after(); } }, 420); }
  function openZoom(src, alt, from) { zoomOpener = from || null; zoomImg.src = src; zoomImg.alt = alt || ''; zoomOpen = true; show(zoom); zoomClose.focus(); }
  function closeZoom() { if (!zoomOpen) return; zoomOpen = false; hide(zoom, function () { zoomImg.removeAttribute('src'); }); (zoomOpener || lbClose).focus(); }
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
      var zb = d.createElement('button'); zb.type = 'button'; zb.className = 'lb-zoom'; zb.setAttribute('aria-label', 'Enlarge image');
      var big = d.createElement('img'); big.src = imgs[0].getAttribute('src'); big.alt = imgs[0].alt; zb.appendChild(big); lbMain.appendChild(zb);
      lbHint.hidden = false;
      zb.addEventListener('click', function () { openZoom(big.src, big.alt, zb); });
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
    lbOpen = true;
    show(lb);
    queueUnstub($$('p', lbBody));
    main.inert = true; nav.inert = true;
    if (universe) universe.setPaused(true);
    if (lenis) lenis.stop();
    d.body.style.overflow = 'hidden';
    lbClose.focus();
  }
  function closeLB() {
    if (!lbOpen) return;
    lbOpen = false;
    if (zoomOpen || !zoom.hidden) { zoomOpen = false; zoom.classList.remove('open'); zoom.hidden = true; }
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
      if (zoomOpen) closeZoom(); else if (lbOpen) closeLB(); else closeMenu();
      return;
    }
    if (e.key !== 'Tab') return;
    var box = zoomOpen ? zoom : lbOpen ? lb : null;
    if (!box) return;
    var f = $$('button,[href],[tabindex]:not([tabindex="-1"])', box).filter(function (x) { return !x.hidden && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  }, { passive: false });

  /* ---------- pointer details: cursor ring, metal highlight ---------- */
  if (fine) {
    var ring = $('.cur-ring'), lab = $('.cur-label');
    var cx = -100, cy = -100, rx = -100, ry = -100, moving = 0, lastT = 0;
    function loop(t) {
      var k = 1 - Math.exp(-Math.min(0.05, lastT ? (t - lastT) / 1000 : 1 / 60) * 15); lastT = t;
      rx += (cx - rx) * k; ry += (cy - ry) * k;
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      if (Math.abs(cx - rx) + Math.abs(cy - ry) > 0.3) moving = requestAnimationFrame(loop); else { moving = 0; lastT = 0; }
    }
    on(window, 'mousemove', function (e) {
      if (reduce || motionOff) return;
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
      // no reset on leave: the light fades out where the pointer left it instead of jumping
    });
    /* the line under the ticker: the pointer carries a window across the words. One custom
       property write per frame, on one element; the mask repaints, nothing reflows. */
    var lede = $('#ledeStack');
    if (lede) {
      var lx = 0, ly = 0, ledeQueued = false;
      var paintLede = function () {
        ledeQueued = false;
        lede.style.setProperty('--hx', lx.toFixed(1) + 'px');
        lede.style.setProperty('--hy', ly.toFixed(1) + 'px');
      };
      on(lede, 'pointermove', function (e) {
        var r = lede.getBoundingClientRect();
        lx = e.clientX - r.left; ly = e.clientY - r.top;
        if (!ledeQueued) { ledeQueued = true; requestAnimationFrame(paintLede); }
      });
      on(lede, 'pointerenter', function (e) {
        var r = lede.getBoundingClientRect();
        lx = e.clientX - r.left; ly = e.clientY - r.top;
        paintLede();
        lede.classList.add('lit');
      });
      on(lede, 'pointerleave', function () { lede.classList.remove('lit'); });
    }
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
  // the icon says what pressing does next, and so does the label it carries for anyone
  // who cannot see the icon; no aria-pressed on top of that
  function paintMotion() {
    var label = motionOff ? 'Resume motion' : 'Pause motion';
    motionBtn.setAttribute('aria-label', label);
    motionBtn.setAttribute('title', label);
  }
  paintMotion();
  function applyStill() {
    var still = reduce || motionOff;
    h.classList.toggle('still', still);
    h.classList.toggle('motion-off', motionOff);
    // SMIL isn't touched by CSS animation rules: pause the flight path explicitly
    $$('.route-map').forEach(function (svg) { try { if (still) svg.pauseAnimations(); else svg.unpauseAnimations(); } catch (e) { /* no SMIL */ } });
    if (universe) universe.setStill(still);
    paintForms();
    if (still) { stopLenis(); h.classList.remove('cursor-on'); visuals.forEach(function (v) { v.style.removeProperty('--py'); }); }
    else loadLenis();
  }
  on(motionBtn, 'click', function () {
    motionOff = !motionOff;
    try { localStorage.setItem('ce_motion', motionOff ? 'off' : 'on'); } catch (e) { /* private mode */ }
    paintMotion();
    applyStill();
  });
  on(mqReduce, 'change', function (e) {
    reduce = e.matches;
    if (reduce && !finished && playing) { skip(); finish(); }
    applyStill();
    if (!reduce && !universe && !booting) boot();
  });

  /* ---------- entrance ---------- */
  var intro = $('#intro'), introName = $('#introName'), role = $('.intro-role'), quote = $('.intro-quote'), bar = $('.intro-prog i');
  var playing = h.classList.contains('intro-on');
  // the quote types in 2.1 s (0.35 → 2.45) and then holds for 1.85 s before it fades
  // (Mark, 2026-09-13: typing 0.7 s quicker, a 0.3 s longer hold); everything after it
  // keeps its old spacing, 0.4 s earlier. universe.js times the galaxy from conv[0].
  var T = { type1: [0.35, 1.25], type2: [1.3, 2.45], qOut: [4.3, 4.8], conv: [4.4, 5.5], nameIn: [5.05, 5.5], roleIn: [5.3, 5.75], brk: 6.5, brkDur: 2.45, roleOut: [6.35, 6.65], reveal: 7.8 };
  var state = { t0: null, T: T, done: false };
  if (new URLSearchParams(location.search).has('debug')) window.__intro = state;   // exposed before the module loads, so tests can see the real start
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
    loadLenis();
    setTimeout(function () { h.classList.remove('revealing'); shine($('#heroTitle')); }, 1400);
    measure(); onScroll();
  }
  function finish() {
    if (finished) return;
    finished = true;
    state.finishes = (state.finishes || 0) + 1;   // observable in ?debug=1, so tests can tell who ended the entrance
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
    setTimeout(reveal, 300);   // let the typed text fade before the overlay goes
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
    if (skipped) return;   // skip() owns the ending now, after its fade
    if (state.done || t > T.brk + T.brkDur + 0.3) { finish(); return; }
    requestAnimationFrame(tick);
  }
  function startIntro() {
    if (state.t0 != null || finished || skipped) return;
    state.t0 = performance.now();
    watchdog = setTimeout(finish, 13000);   // counted from the real start, never while the tab was in the background
    if (universe) universe.start();
    requestAnimationFrame(tick);
  }
  if (playing) {
    var scrollArmed = false;
    function holdTop() { if ((window.scrollY || 0) > 0) window.scrollTo(0, 0); }
    holdTop();
    afterFirstFrame(function () { holdTop(); setTimeout(function () { holdTop(); scrollArmed = true; }, 300); });
    on(intro, 'click', skip);
    on($('#introSkip'), 'click', function (e) { e.stopPropagation(); skip(); });
    on(window, 'wheel', function (e) { if (Math.abs(e.deltaY) > 4) skip(); });
    on(window, 'touchmove', skip);
    on(window, 'keydown', function (e) { if (['Tab', 'Escape', 'Enter', ' ', 'ArrowDown', 'PageDown', 'End'].indexOf(e.key) > -1) skip(); });
    on(window, 'scroll', function () { if (!scrollArmed) return holdTop(); if ((window.scrollY || 0) > 10) skip(); });
    // opened in a background tab: the entrance waits until someone is looking;
    // hidden once it is running, it hands the page straight back
    on(d, 'visibilitychange', function () {
      if (d.hidden) { if (state.t0 != null) { skip(); finish(); } }
      else if (!started) go();
    });
    on(window, 'pageshow', function (e) { if (e.persisted && !finished) { skip(); finish(); } });
    // don't wait on webfonts for long: the name is sampled from real glyphs later anyway
    var started = false, go = function () { if (started || d.hidden) return; started = true; startIntro(); };
    afterFirstFrame(function () { if (d.fonts && d.fonts.ready) d.fonts.ready.then(go); });
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
  var booting = false, rendererOk = false;
  // gl-forms: the particles can draw the contact mark (a live renderer, a tier with
  // shapes, motion running), so the solid mark stays hidden and they gather into it
  function paintForms() { h.classList.toggle('gl-forms', !!(universe && universe.forms && rendererOk && !reduce && !motionOff)); }
  function boot() {
    if (booting || universe) return;
    booting = true;
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
        onForm: function (v) { h.classList.toggle('gl-form', v); },
        // a lost or failed renderer hands the stage back to the static stars and the solid logo
        onRenderer: function (r) { rendererOk = r === 'webgl' || r === '2d'; h.classList.toggle('gl-on', rendererOk); if (!rendererOk) h.classList.remove('gl-form'); paintForms(); }
      });
      paintForms();
      if (geo) universe.setSections(geo.list, geo.mark, geo.axis);
      if (reduce || motionOff) universe.setStill(true);
      if (lbOpen) universe.setPaused(true);
      universe.start();
      if (new URLSearchParams(location.search).has('debug')) window.__universe = universe;
    }).catch(function (err) {
      booting = false;
      h.classList.remove('gl-on');
      if (window.console && /debug/.test(location.search)) console.warn('universe unavailable', err);
    });
  }
  // the entrance needs the particles now; otherwise let the page settle first
  if (!reduce) { if (playing) boot(); else (window.requestIdleCallback || setTimeout)(boot, { timeout: 700 }); }

  /* bfcache and unload: give GPU memory back */
  on(window, 'pagehide', function (e) { if (!e.persisted && universe) { universe.destroy(); universe = null; paintForms(); } });
  applyStill();
  window.__ceReady = true;
})();
