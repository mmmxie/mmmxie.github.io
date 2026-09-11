/* Prototype only. UI is independent of the optional particle renderer. */
(() => {
  'use strict';
  let teardown = () => {};
  function mount() {
    teardown();
    const abort = new AbortController();
    const signal = abort.signal;
    const root = document.documentElement;
    const $ = s => document.querySelector(s);
    const all = s => [...document.querySelectorAll(s)];
    const listen = (el, event, fn, options = {}) => el?.addEventListener(event, fn, { ...options, signal });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let field = null, disposed = false, effectGeneration = 0, paused = false, scrollFrame = 0;
    let sections = [], totalHeight = 1, selected = '';
    const nav = $('nav'), menu = $('#menuToggle'), navLinks = $('#navLinks');
    const motion = $('#motionToggle'), replay = $('#replayIntro'), theme = $('#theme');
    const dialog = $('#lb'), zoom = $('#zoom'), lbBody = $('#lbBody'), lbMain = $('#lbMain');
    const lbThumbs = $('#lbThumbs'), zoomImg = $('#zoomImg');
    let returnFocus = null, zoomReturn = null, galleryImages = [];
    let galleryAbort = new AbortController(), imageAbort = new AbortController();
    let messageAnimations = [], messageGeneration = 0;
    function settleMessage() {
      messageGeneration++;
      messageAnimations.forEach(a => a.cancel()); messageAnimations = [];
      all('#introMessage .typed-copy').forEach(el => el.remove());
      all('#introMessage p').forEach(p => p.classList.remove('is-typing'));
    }
    function revealMessage() {
      settleMessage();
      if (paused || reduced.matches || scrollY > 20) return;
      const generation = messageGeneration;
      let index = 0;
      all('#introMessage p').forEach(p => {
        // The original, intact text remains in the accessibility tree and
        // determines layout. The temporary visual copy cannot be selected.
        const overlay = document.createElement('span');
        overlay.className = 'typed-copy'; overlay.setAttribute('aria-hidden', 'true');
        overlay.append(...[...p.textContent].map(char => {
          const span = document.createElement('span'); span.textContent = char;
          messageAnimations.push(span.animate([{ opacity: 0 }, { opacity: 1 }],
            { duration: 1, delay: index++ * 24, fill: 'both' }));
          return span;
        }));
        p.classList.add('is-typing'); p.append(overlay);
      });
      messageAnimations.at(-1)?.finished.then(() => {
        if (generation === messageGeneration) settleMessage();
      }).catch(() => {});
    }
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
    root.classList.add('enhanced');
    const savedTheme = read('portfolio-prototype-theme') || read('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
    paused = read('portfolio-prototype-motion') === 'paused';
    menu.hidden = false;
    motion.hidden = false;
    theme.hidden = false;
    function menuOpen(open) {
      navLinks.classList.toggle('open', open);
      menu.setAttribute('aria-expanded', String(open));
    }
    listen(menu, 'click', () => menuOpen(menu.getAttribute('aria-expanded') !== 'true'));
    listen(document, 'click', e => { if (!nav.contains(e.target)) menuOpen(false); });
    listen(document, 'keydown', e => {
      if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
        menuOpen(false); menu.focus();
      }
    });
    function setTheme() {
      const dark = root.dataset.theme === 'dark';
      theme.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      document.querySelector('meta[name="theme-color"]')?.remove();
      const meta = document.createElement('meta');
      meta.name = 'theme-color'; meta.content = getComputedStyle(root).getPropertyValue('--color-paper').trim();
      document.head.append(meta);
      field?.refreshColour();
    }
    setTheme();
    listen(theme, 'click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      save('portfolio-prototype-theme', root.dataset.theme);
      setTheme();
    });
    function motionState() {
      if (paused || reduced.matches) settleMessage();
      root.classList.toggle('motion-paused', paused || reduced.matches);
      motion.disabled = reduced.matches;
      motion.setAttribute('aria-pressed', String(paused || reduced.matches));
      motion.setAttribute('aria-label', reduced.matches ? 'Motion reduced by your device setting' : paused ? 'Resume motion' : 'Pause motion');
      motion.querySelector('.motion-label').textContent = paused ? 'Resume motion' : 'Pause motion';
      motion.firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
      replay.hidden = reduced.matches || !field;
      field?.setPaused(paused);
      syncRoute();
    }
    listen(motion, 'click', () => {
      paused = !paused;
      save('portfolio-prototype-motion', paused ? 'paused' : 'running');
      motionState();
    });
    async function startEffect() {
      const generation = ++effectGeneration;
      field?.destroy(); field = null;
      root.classList.remove('field-started', 'field-ready');
      root.classList.remove('effect-pending');
      $('#introName').classList.remove('in-canvas');
      const canvas = $('#fieldCanvas');
      canvas.hidden = true;
      motionState();
      if (reduced.matches) return;
      root.classList.add('effect-pending');
      try {
        const module = await import('./field.js');
        if (disposed || generation !== effectGeneration || reduced.matches) return;
        // A font failure never postpones access to the portfolio.
        let fontTimer;
        await Promise.race([
          document.fonts?.load('600 64px Archivo'),
          new Promise(resolve => { fontTimer = setTimeout(resolve, 900); })
        ]);
        clearTimeout(fontTimer);
        if (disposed || generation !== effectGeneration || reduced.matches) return;
        field = module.createField({
          canvas, name: $('#introName'), root,
          skip: Boolean(location.hash || scrollY > 20 || paused),
          onReady: revealMessage
        });
        field.setSection(selected || 'top');
        root.classList.remove('effect-pending');
        motionState();
      } catch {
        canvas.hidden = true;
        $('#introName').classList.remove('in-canvas');
        root.classList.remove('field-started');
        root.classList.remove('effect-pending');
        replay.hidden = true;
      }
    }
    listen(reduced, 'change', startEffect);
    listen($('#fieldCanvas'), 'field-unavailable', () => {
      field = null; replay.hidden = true; settleMessage(); root.classList.remove('field-ready');
    });
    listen(replay, 'click', () => {
      if (!field || reduced.matches) return;
      paused = false;
      save('portfolio-prototype-motion', 'running');
      motionState();
      window.scrollTo({ top: 0, behavior: 'instant' });
      field.replay();
    });
    all('a[href^="#"]').forEach(a => listen(a, 'click', e => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      menuOpen(false);
      field?.finishIntro();
      target.scrollIntoView({ behavior: reduced.matches || paused ? 'instant' : 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
      const focusTarget = target.querySelector('h1,h2') || target;
      const previous = focusTarget.getAttribute('tabindex');
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
      listen(focusTarget, 'blur', () => {
        if (previous === null) focusTarget.removeAttribute('tabindex');
        else focusTarget.setAttribute('tabindex', previous);
      }, { once: true });
    }));
    listen($('#toTop'), 'click', () => {
      window.scrollTo({ top: 0, behavior: reduced.matches || paused ? 'instant' : 'smooth' });
      $('.brand').focus({ preventScroll: true });
    });
    function measure() {
      sections = all('section[id]').map(el => ({ el, id: el.id, top: el.getBoundingClientRect().top + scrollY }));
      totalHeight = Math.max(1, root.scrollHeight - innerHeight);
      updateScroll();
    }
    function updateScroll() {
      scrollFrame = 0;
      const y = scrollY;
      $('.progress').style.transform = 'scaleX(' + Math.min(1, y / totalHeight) + ')';
      nav.classList.toggle('scrolled', y > 24);
      $('#toTop').classList.toggle('show', y > innerHeight);
      let active = '';
      for (const section of sections) if (section.top <= y + innerHeight * .4) active = section.id;
      if (active !== selected) {
        selected = active;
        root.dataset.section = active || 'top';
        all('.nav-link').forEach(a => {
          if (a.hash === '#' + active) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
        field?.setSection(active || 'top');
      }
      field?.setScroll(y, totalHeight);
    }
    listen(window, 'scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); }, { passive: true });
    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(document.querySelector('main'));
    listen(window, 'resize', measure, { passive: true });
    listen(window, 'load', measure, { once: true });
    document.fonts?.ready.then(() => { if (!disposed) measure(); });
    measure();

    // Native dialogs provide inert background, Escape handling and focus containment.
    all('.visual[data-open]').forEach((button, i) => {
      const title = button.closest('.case').querySelector('h3').textContent;
      button.setAttribute('aria-label', 'Open case study: ' + title);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      listen(button, 'click', () => openCase(button, i));
    });
    function gallery(index) {
      imageAbort.abort(); imageAbort = new AbortController();
      const image = galleryImages[index];
      if (!image) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'zoom-trigger';
      button.setAttribute('aria-label', 'Enlarge ' + image.alt);
      const img = image.cloneNode();
      img.loading = 'eager'; button.append(img);
      lbMain.replaceChildren(button);
      all('#lbThumbs button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
      button.addEventListener('click', () => {
        zoomReturn = button;
        zoomImg.src = img.src; zoomImg.alt = img.alt;
        zoom.showModal(); $('#zoomClose').focus();
      }, { signal: imageAbort.signal });
    }
    function openCase(button) {
      galleryAbort.abort(); galleryAbort = new AbortController();
      const article = button.closest('.case');
      returnFocus = button;
      lbMain.replaceChildren(); lbBody.replaceChildren(); lbThumbs.replaceChildren();
      const kicker = document.createElement('span'); kicker.className = 'kicker'; kicker.textContent = 'Case study';
      const heading = document.createElement('h3'); heading.textContent = article.querySelector('h3').textContent;
      heading.id = 'caseDialogTitle';
      lbBody.append(kicker, heading);
      const details = article.querySelector('.more-text');
      if (details) lbBody.append(...[...details.children].map(el => el.cloneNode(true)));
      const docs = article.querySelector('.more-docs');
      if (docs) lbBody.append(docs.cloneNode(true));
      galleryImages = [...article.querySelectorAll('.more-media img')];
      if (galleryImages.length) {
        galleryImages.forEach((im, i) => {
          const b = document.createElement('button'); b.type = 'button';
          b.setAttribute('aria-label', 'Show ' + im.alt); b.setAttribute('aria-pressed', String(i === 0));
          b.append(im.cloneNode());
          b.addEventListener('click', () => gallery(i), { signal: galleryAbort.signal }); lbThumbs.append(b);
        });
        gallery(0);
      } else {
        const cover = button.querySelector('.cover')?.cloneNode(true);
        if (cover) {
          cover.classList.remove('demo-cycling');
          cover.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
          lbMain.append(cover);
        }
      }
      lbThumbs.hidden = galleryImages.length < 2;
      $('#lbHint').hidden = !galleryImages.length;
      dialog.setAttribute('aria-labelledby', heading.id);
      dialog.showModal();
      root.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      dialog.scrollTop = 0;
      field?.setModal(true);
      syncRoute();
      (lbMain.querySelector('button') || $('#lbClose')).focus({ preventScroll: true });
    }
    function closeCase() { if (zoom.open) zoom.close(); dialog.close(); }
    listen($('#lbClose'), 'click', closeCase);
    listen($('#zoomClose'), 'click', () => zoom.close());
    // Keep Tab on the open surface rather than letting native dialog tab order
    // briefly transfer focus to browser chrome at the end of its controls.
    listen(document, 'keydown', e => {
      if (e.key !== 'Tab') return;
      const activeDialog = zoom.open ? zoom : dialog.open ? dialog : null;
      if (!activeDialog) return;
      const controls = [...activeDialog.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === activeDialog)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    const outside = (d, e) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    listen(dialog, 'click', e => { if (e.target === dialog && outside(dialog, e)) closeCase(); });
    listen(zoom, 'click', e => { if (e.target === zoom && outside(zoom, e)) zoom.close(); });
    listen(dialog, 'close', () => {
      galleryAbort.abort(); imageAbort.abort(); zoomReturn = null;
      document.body.style.overflow = '';
      root.style.overflow = '';
      field?.setModal(false);
      returnFocus?.focus({ preventScroll: true });
      lbMain.replaceChildren(); lbBody.replaceChildren(); lbThumbs.replaceChildren();
      galleryImages = [];
    });
    listen(zoom, 'close', () => {
      zoomImg.removeAttribute('src');
      zoomReturn?.focus({ preventScroll: true });
    });
    // Existing demonstration copy stays intact. One shared clock, visible covers only.
    const covers = all('.visual .cover');
    const visibleCovers = new Set();
    function syncRoute() {
      all('svg.route-map').forEach(svg => {
        const cover = svg.closest('.cover');
        const stop = disposed || paused || reduced.matches || document.hidden || dialog.open ||
          !visibleCovers.has(cover) || cover?.closest('.visual').matches(':hover,:focus-visible');
        if (stop) svg.pauseAnimations?.(); else svg.unpauseAnimations?.();
        if (reduced.matches) svg.setCurrentTime?.(0);
      });
    }
    const coverObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      for (const e of entries) e.isIntersecting ? visibleCovers.add(e.target) : visibleCovers.delete(e.target);
      syncRoute();
    }, { rootMargin: '80px' }) : null;
    covers.forEach(c => coverObserver ? coverObserver.observe(c) : visibleCovers.add(c));
    covers.forEach(c => {
      const visual = c.closest('.visual');
      for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) listen(visual, event, syncRoute);
    });
    listen(document, 'visibilitychange', syncRoute);
    listen(dialog, 'close', syncRoute);
    let demoTick = 0;
    const demoTimer = setInterval(() => {
      if (disposed || paused || reduced.matches || document.hidden || dialog.open) return;
      demoTick++;
      visibleCovers.forEach(cover => {
        if (cover.closest('.visual').matches(':hover,:focus-visible')) return;
        cover.classList.add('demo-cycling');
        cover.querySelectorAll('.picks,.screen,.briefs,.fares').forEach(group => {
          [...group.children].filter(el => el.classList.contains('scene')).forEach((scene, i, list) => scene.classList.toggle('is-active', i === demoTick % list.length));
        });
        const steps = [...cover.querySelectorAll('.rail .st')];
        steps.forEach((el, i) => el.classList.toggle('is-active', i === demoTick % steps.length));
        const line = cover.querySelector('.rail-fill');
        if (line) line.style.transform = 'scaleX(' + ((demoTick % 5 + 1) / 5) + ')';
        for (const group of ['.route-legs .leg', '.merchants .mc']) {
          const items = [...cover.querySelectorAll(group)];
          items.forEach((el, i) => el.classList.toggle('is-active', i === demoTick % items.length));
        }
      });
    }, 3600);
    const rowObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(e => e.target.classList.toggle('is-current', e.isIntersecting));
    }, { rootMargin: '-30% 0px -35% 0px' }) : null;
    all('.tl-row').forEach(el => rowObserver?.observe(el));
    teardown = () => {
      disposed = true; effectGeneration++;
      syncRoute();
      abort.abort(); field?.destroy(); field = null;
      settleMessage();
      galleryAbort.abort(); imageAbort.abort();
      cancelAnimationFrame(scrollFrame);
      clearInterval(demoTimer);
      resizeObserver?.disconnect(); coverObserver?.disconnect(); rowObserver?.disconnect();
      if (zoom.open) zoom.close();
      if (dialog.open) dialog.close();
      document.body.style.overflow = '';
      root.style.overflow = '';
    };
    motionState();
    startEffect();
  }
  mount();
  window.addEventListener('pagehide', () => teardown());
  window.addEventListener('pageshow', e => { if (e.persisted) mount(); });
})();
