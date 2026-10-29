// AI-Trans — content script
// In-place page translation: only text nodes are replaced (nodeValue), so the original
// layout, fonts and interactions are fully preserved. Handles dynamic content (games,
// infinite scroll, live text) via a MutationObserver, plus a draggable floating widget.
(() => {
  const translated = new Map(); // Text node -> { orig, written }
  let isRunning = false;
  let pending = false;
  let observer = null;
  let toastTimer = null;
  let settings = {
    provider: 'deepseek',
    model: '',
    targetLang: '',
    uiLang: aiTransDetect(),
    globalAuto: false,
    autoSites: {}
  };

  const TOAST_ID = 'ai-trans-toast';
  const WIDGET_ID = 'ai-trans-widget';
  const PANEL_ID = 'ai-trans-panel';
  const CONCURRENCY = 5;   // parallel API requests
  const CACHE_KEY = 'transCacheV1';
  const CACHE_CAP = 20000;          // 缓存条目数上限
  const CACHE_SIZE_CHARS = 2000000; // 缓存总字符数上限（约 6MB，storage.local 配额为 10MB）
  const cache = new Map(); // "targetLang|host|text" -> translation

  const t = (key, vars) => aiTransT(settings.uiLang, key, vars);

  // ---------- Toast ----------
  function toast(text, sticky = false) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.setAttribute('translate', 'no');
      el.style.cssText =
        'position:fixed;right:16px;bottom:110px;z-index:2147483647;background:rgba(17,24,39,.94);color:#fff;' +
        'font:13px/1.5 system-ui,sans-serif;padding:10px 14px;border-radius:10px;max-width:420px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;transition:opacity .3s;';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2400);
  }

  // ---------- Node filtering ----------
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'KBD', 'SAMP', 'VAR', 'PRE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO'
  ]);

  function cjkRatio(text) {
    let cjk = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)) cjk++;
    }
    return cjk / Math.max(1, text.length);
  }

  function shouldSkip(parent) {
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (parent.closest('#' + TOAST_ID + ', #' + WIDGET_ID + ', #' + PANEL_ID)) return true;
    if (parent.isContentEditable) return true;
    if (parent.closest('[translate="no"],[contenteditable="true"],[contenteditable="plaintext-only"]')) return true;
    let visible;
    try {
      visible = parent.checkVisibility ? parent.checkVisibility() : parent.getClientRects().length > 0;
    } catch (e) { visible = true; }
    if (!visible) return true;
    return false;
  }

  function collect(root) {
    const found = [];
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (translated.has(n)) return NodeFilter.FILTER_REJECT;
        const parent = n.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
        const raw = n.nodeValue;
        if (!raw) return NodeFilter.FILTER_REJECT;
        const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const core = m[2];
        if (!core) return NodeFilter.FILTER_REJECT;
        if (!/\p{L}/u.test(core)) return NodeFilter.FILTER_REJECT;
        if (settings.targetLang.startsWith('zh') && cjkRatio(core) > 0.35) return NodeFilter.FILTER_REJECT;
        if (core.length > 4000) return NodeFilter.FILTER_REJECT;
        n._ds = { lead: m[1], trail: m[3], core };
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) found.push(n);
    return found;
  }

  function chunk(nodes, maxChars = 8000, maxItems = 80) {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const n of nodes) {
      const core = n._ds.core;
      if (cur.length && (len + core.length > maxChars || cur.length >= maxItems)) {
        chunks.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(n);
      len += core.length;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  // ---------- Cache ----------
  function cacheKey(core) {
    return settings.targetLang + '|' + location.hostname + '|' + core;
  }

  // LRU 缓存：新写入/命中的条目排到最前，超限时淘汰最久未用的
  function cacheSet(k, v) {
    cache.delete(k);
    cache.set(k, v);
    if (cache.size > CACHE_CAP) {
      cache.delete(cache.keys().next().value);
    }
    scheduleCacheSave();
  }

  let cacheSaveTimer = null;
  function scheduleCacheSave() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(flushCache, 800);
  }

  function buildCacheObj() {
    const obj = {};
    let count = 0;
    let size = 0;
    for (const [k, v] of cache) {
      obj[k] = v;
      size += k.length + v.length;
      if (++count >= CACHE_CAP || size > CACHE_SIZE_CHARS) break;
    }
    return obj;
  }

  async function flushCache() {
    clearTimeout(cacheSaveTimer);
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: buildCacheObj() });
    } catch (e) {
      // 存储配额不够：淘汰一半最久未用的缓存后重试一次
      const half = Math.ceil(cache.size / 2);
      for (let i = 0; i < half && cache.size; i++) cache.delete(cache.keys().next().value);
      try { await chrome.storage.local.set({ [CACHE_KEY]: buildCacheObj() }); } catch (e2) {}
    }
  }

  window.addEventListener('pagehide', () => { flushCache(); });

  function inViewport(el) {
    try {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0 && r.width > 0;
    } catch (e) { return false; }
  }

  function fmtTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  async function runPool(items, worker) {
    const queue = items.slice();
    let idx = 0;
    const n = Math.min(CONCURRENCY, queue.length);
    const runners = Array.from({ length: n }, async () => {
      while (true) {
        const item = queue[idx++];
        if (item === undefined) break;
        await worker(item);
      }
    });
    await Promise.all(runners);
  }

  // ---------- Main flow: translate + replace in place ----------
  async function translatePage(root, opts = {}) {
    if (isRunning) { pending = true; return; }

    const nodes = collect(root);
    if (!nodes.length) {
      if (!opts.silent) toast(t('tNoContent'));
      return;
    }

    isRunning = true;
    let done = 0;
    let failed = false;
    let firstError = '';
    let misses = [];
    let runTokens = 0;
    const total = nodes.length;
    try {
      // 1) cache hits are applied instantly without any API call
      misses = [];
      for (const n of nodes) {
        const ck = cacheKey(n._ds.core);
        const hit = cache.get(ck);
        if (hit) {
          cache.delete(ck); cache.set(ck, hit); // LRU 刷新
          const before = n.nodeValue;
          const written = n._ds.lead + hit + n._ds.trail;
          translated.set(n, { orig: before, written });
          n.nodeValue = written;
          delete n._ds;
          done++;
        } else {
          misses.push(n);
        }
      }

      // 2) misses: viewport-first, parallel batches
      misses.sort((a, b) => (inViewport(a.parentElement) ? 0 : 1) - (inViewport(b.parentElement) ? 0 : 1));
      const chunks = chunk(misses, 8000, 80);
      await runPool(chunks, async (c) => {
        const res = await chrome.runtime.sendMessage({
          type: 'DS_API',
          texts: c.map((n) => n._ds.core)
        });
        if (!res || !res.ok) {
          failed = true;
          if (!firstError) {
            firstError = (res && res.code)
              ? aiTransErrText(settings.uiLang, res.code, res.detail)
              : t('errUnknown', { e: '' });
          }
          return;
        }
        if (res.usage) {
          runTokens += (res.usage.prompt_tokens || 0) + (res.usage.completion_tokens || 0);
        }
        const trans = res.translations || [];
        c.forEach((n, i) => {
          const tr = trans[i];
          if (typeof tr === 'string' && tr.trim()) {
            cacheSet(cacheKey(n._ds.core), tr);
            const before = n.nodeValue;
            const written = n._ds.lead + tr + n._ds.trail;
            translated.set(n, { orig: before, written });
            n.nodeValue = written; // text node only — layout/fonts untouched
            delete n._ds;
          } else {
            // model missed this item: keep the original and mark as done to avoid retry loops
            translated.set(n, { orig: n.nodeValue, written: n.nodeValue });
            delete n._ds;
          }
        });
        done += c.length;
        flushCache(); // persist immediately — cache survives refreshes
        if (!opts.silent) toast(t('tTranslating', { p: Math.round((done / total) * 100) }));
      });
    } catch (e) {
      failed = true;
      // Chrome 内部报错（如扩展刚更新、消息通道断开）是英文的，这里统一转成本地化提示
      const m = String((e && e.message) || e);
      if (/could not establish|receiving end|port closed|extension context/i.test(m)) firstError = t('errNoConn');
      else firstError = m;
    } finally {
      isRunning = false;
      if (failed) toast(t('tError', { e: firstError }), true);
      else if (!opts.silent && done > 0) {
        toast(misses.length ? t('tDone', { t: fmtTokens(runTokens) }) : t('tCacheDone'));
      }
      if (pending) {
        pending = false;
        setTimeout(() => translatePage(root, opts), 300);
      }
    }
  }

  // ---------- Restore ----------
  function restorePage() {
    let count = 0;
    for (const [node, rec] of translated) {
      node.nodeValue = rec.orig;
      count++;
    }
    translated.clear();
    stopObserver();
    toast(count ? t('tRestored', { n: count }) : t('tNothingRestored'));
  }

  // ---------- Auto-translate: watch dynamic content ----------
  function startObserver() {
    if (observer || !document.body) return;
    let timer = null;
    observer = new MutationObserver((muts) => {
      // If the site rewrote a translated node (game questions, live text…), un-mark it for re-translation
      for (const m of muts) {
        if (m.type === 'characterData') {
          const rec = translated.get(m.target);
          if (rec && m.target.nodeValue !== rec.written) translated.delete(m.target);
        }
      }
      clearTimeout(timer);
      timer = setTimeout(() => translatePage(document.body, { silent: true }), 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ---------- Floating widget: draggable, one click to translate / restore ----------
  let widgetSuppressClick = false;
  let widgetDrag = null;
  let widgetButtons = { trans: null, panel: null, restore: null };

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // 拖动期间锁定页面文本选择，并阻止浏览器原生拖拽（否则会出现"虚影"且面板不跟手）
  function dragLockStart(e) {
    if (e.pointerType === 'mouse') e.preventDefault();
    try { window.getSelection().removeAllRanges(); } catch (err) {}
    document.documentElement.style.userSelect = 'none';
  }

  function dragLockEnd() {
    document.documentElement.style.userSelect = '';
  }

  function applyWidgetPos(box, x, y) {
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  }

  function ensureWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    const box = document.createElement('div');
    box.id = WIDGET_ID;
    box.setAttribute('translate', 'no');
    box.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;' +
      'user-select:none;touch-action:none;';
    const mk = (text, title, bg, color) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title + '\n' + t('wDrag');
      b.style.cssText =
        'width:40px;height:40px;border:0;border-radius:50%;font:600 14px system-ui,"Segoe UI",sans-serif;' +
        'cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);background:' + bg + ';color:' + color + ';';
      return b;
    };
    const btnT = mk(t('wBtnTranslate'), t('wTrans'), 'rgba(59,91,219,.92)', '#fff');
    btnT.addEventListener('click', () => {
      if (widgetSuppressClick) { widgetSuppressClick = false; return; }
      translatePage(document.body);
      startObserver();
    });
    const btnR = mk(t('wBtnRestore'), t('wRestore'), 'rgba(255,255,255,.96)', '#4b5563');
    btnR.style.border = '1px solid #e5e7eb';
    btnR.addEventListener('click', () => {
      if (widgetSuppressClick) { widgetSuppressClick = false; return; }
      restorePage();
    });
    const btnP = mk('✎', t('wPanelTitle'), 'rgba(255,255,255,.96)', '#4b5563');
    btnP.style.border = '1px solid #e5e7eb';
    btnP.addEventListener('click', () => {
      if (widgetSuppressClick) { widgetSuppressClick = false; return; }
      togglePanel();
    });
    box.append(btnT, btnP, btnR);
    widgetButtons.trans = btnT;
    widgetButtons.panel = btnP;
    widgetButtons.restore = btnR;

    // Drag (>=5px counts as drag; a plain click still fires the buttons).
    // Do NOT use setPointerCapture — it retargets the click away from the buttons.
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.pointerType === 'mouse') e.preventDefault(); // 阻止原生拖拽（防止虚影）
      const rect = box.getBoundingClientRect();
      widgetDrag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
      const onMove = (ev) => {
        if (!widgetDrag) return;
        const dx = ev.clientX - widgetDrag.sx;
        const dy = ev.clientY - widgetDrag.sy;
        if (!widgetDrag.moved && Math.hypot(dx, dy) > 5) {
          widgetDrag.moved = true;
          if (ev.pointerType === 'mouse') ev.preventDefault();
          try { window.getSelection().removeAllRanges(); } catch (err) {}
          document.documentElement.style.userSelect = 'none';
          box.style.transition = 'none';
        }
        if (widgetDrag.moved) {
          applyWidgetPos(
            box,
            clamp(widgetDrag.ox + dx, 0, window.innerWidth - box.offsetWidth),
            clamp(widgetDrag.oy + dy, 0, window.innerHeight - box.offsetHeight)
          );
        }
      };
      const onUp = () => {
        if (!widgetDrag) return;
        const moved = widgetDrag.moved;
        const rect2 = box.getBoundingClientRect();
        document.documentElement.style.userSelect = '';
        if (moved) {
          widgetSuppressClick = true;
          setTimeout(() => { widgetSuppressClick = false; }, 0);
          try {
            chrome.storage.local.set({ widgetPos: { x: Math.round(rect2.left), y: Math.round(rect2.top) } }).catch(() => {});
          } catch (err) {}
        }
        widgetDrag = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    (document.body || document.documentElement).appendChild(box);

    // restore last dragged position
    try {
      chrome.storage.local.get(['widgetPos']).then((s) => {
        if (s.widgetPos && typeof s.widgetPos.x === 'number' && typeof s.widgetPos.y === 'number') {
          const w = box.offsetWidth || 86;
          const h = box.offsetHeight || 86;
          applyWidgetPos(box, clamp(s.widgetPos.x, 0, window.innerWidth - w), clamp(s.widgetPos.y, 0, window.innerHeight - h));
        }
      }).catch(() => {});
    } catch (err) {}
  }

  // ---------- 文本翻译面板（谷歌翻译风格：左原文右译文、自动检测、互换语言） ----------
  let panel = null;
  let panelDrag = null;
  let panelTimer = null;
  let panelSrc = ''; // 'auto' 或语言码
  let panelTgt = '';

  function panelTargetDefault() {
    return settings.targetLang || aiTransDefaultTarget(settings.uiLang);
  }

  // 模型返回的英文语言名 → 用 Intl.DisplayNames 转成本地化名称
  const DETECTED_MAP = {
    'english': 'en', 'simplified chinese': 'zh-CN', 'chinese': 'zh-CN', 'traditional chinese': 'zh-TW',
    'japanese': 'ja', 'korean': 'ko', 'german': 'de', 'french': 'fr', 'spanish': 'es', 'russian': 'ru',
    'portuguese': 'pt', 'italian': 'it', 'arabic': 'ar', 'hindi': 'hi', 'thai': 'th', 'vietnamese': 'vi',
    'dutch': 'nl', 'polish': 'pl', 'turkish': 'tr', 'indonesian': 'id'
  };

  function localizedLangName(enName) {
    const code = DETECTED_MAP[String(enName || '').toLowerCase()];
    if (code) {
      try {
        const dn = new Intl.DisplayNames([aiTransLang(settings.uiLang)], { type: 'language' });
        const n = dn.of(code);
        if (n) return n;
      } catch (e) {}
    }
    return enName || '';
  }

  // 检测结果显示在"自动检测"右侧，如：自动检测（英语）
  function updateAutoOption() {
    if (!panel) return;
    const o = panel._els.srcSel.options[0];
    if (!o || o.value !== 'auto') return;
    o.textContent = t('panelAuto') + (panel._detected ? ' (' + panel._detected + ')' : '');
  }

  // 分辨率自适应：窗口窄时左右布局改为上下布局
  function responsivePanelBody() {
    if (!panel) return;
    const narrow = panel.offsetWidth < 440;
    panel._els.body.style.flexDirection = narrow ? 'column' : 'row';
  }

  window.addEventListener('resize', () => {
    if (!panel || panel.hidden) return;
    const r = panel.getBoundingClientRect();
    applyPanelPos(
      panel,
      clamp(r.left, 0, Math.max(0, window.innerWidth - panel.offsetWidth)),
      clamp(r.top, 0, Math.max(0, window.innerHeight - panel.offsetHeight))
    );
    panel.style.width = clamp(panel.offsetWidth, 320, Math.max(320, window.innerWidth - 16)) + 'px';
    panel.style.height = clamp(panel.offsetHeight, 240, Math.max(240, window.innerHeight - 16)) + 'px';
    responsivePanelBody();
  });

  function applyPanelPos(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function fillPanelLangs(sel, auto) {
    sel.innerHTML = '';
    if (auto) {
      const o = document.createElement('option');
      o.value = 'auto';
      o.textContent = t('panelAuto');
      sel.appendChild(o);
    }
    for (const code in AI_TRANS_TARGETS) {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = AI_TRANS_TARGETS[code];
      sel.appendChild(o);
    }
    sel.value = auto ? (panelSrc || 'auto') : (panelTgt || panelTargetDefault());
  }

  function persistPanelLangs() {
    if (!panel) return;
    panelSrc = panel._els.srcSel.value;
    panelTgt = panel._els.tgtSel.value;
    chrome.storage.local.set({ panelSrc, panelTgt }).catch(() => {});
  }

  function swapLangs() {
    if (!panel) return;
    const els = panel._els;
    const src = els.srcSel.value;
    const tgt = els.tgtSel.value;
    if (src === 'auto') {
      els.srcSel.value = tgt;
      els.tgtSel.value = panelTargetDefault();
    } else {
      els.srcSel.value = tgt;
      els.tgtSel.value = src;
    }
    persistPanelLangs();
    panelTranslate();
  }

  function setPanelHint(data) {
    if (!panel) return;
    panel._hint = data;
    renderPanelHint();
  }

  // 提示信息结构化存储，界面语言切换时立即用新语言重渲染
  function renderPanelHint() {
    if (!panel) return;
    const d = panel._hint;
    if (!d) { panel._els.hint.textContent = ''; return; }
    if (d.kind === 'busy') panel._els.hint.textContent = '…';
    else if (d.kind === 'detected') panel._els.hint.textContent = t('detected', { l: d.l });
    else if (d.kind === 'tokens') panel._els.hint.textContent = t('panelTokens', { t: d.t });
    else if (d.kind === 'cached') panel._els.hint.textContent = t('panelCached');
    else if (d.kind === 'err') panel._els.hint.textContent = aiTransErrText(settings.uiLang, d.code, d.detail);
    else panel._els.hint.textContent = String(d.text || '');
  }

  async function panelTranslate() {
    if (!panel) return;
    const els = panel._els;
    const text = els.srcArea.value.trim();
    if (!text) {
      els.tgtArea.value = '';
      panel._detected = '';
      updateAutoOption();
      setPanelHint(null);
      return;
    }
    setPanelHint({ kind: 'busy' });
    const src = els.srcSel.value;
    const tgt = els.tgtSel.value;
    // 缓存：同一目标语言的同一段文本直接命中，不调 API
    const ck = tgt + '|panel|' + text;
    const hit = cache.get(ck);
    if (hit) {
      cache.delete(ck); cache.set(ck, hit); // LRU 刷新
      els.tgtArea.value = hit;
      panel._detected = '';
      updateAutoOption();
      setPanelHint({ kind: 'cached' });
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'DS_API',
        texts: [text],
        targetCode: tgt,
        detect: src === 'auto'
      });
      if (!res || !res.ok) {
        setPanelHint({ kind: 'err', code: (res && res.code) || 'UNKNOWN', detail: (res && res.detail) || '' });
        return;
      }
      const tr = res.translations && res.translations[0];
      els.tgtArea.value = typeof tr === 'string' ? tr : '';
      if (typeof tr === 'string' && tr.trim()) {
        cacheSet(ck, tr); // 写入缓存，下次秒回
      }
      panel._detected = (src === 'auto' && res.detected) ? localizedLangName(res.detected) : '';
      updateAutoOption();
      const used = res.usage ? (res.usage.prompt_tokens || 0) + (res.usage.completion_tokens || 0) : 0;
      setPanelHint({ kind: 'tokens', t: fmtTokens(used) });
    } catch (e) {
      setPanelHint({ kind: 'text', text: String((e && e.message) || e) });
    }
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('translate', 'no');
    panel.hidden = true;
    panel.style.cssText =
      'position:fixed;right:70px;bottom:16px;z-index:2147483646;width:560px;height:380px;max-width:calc(100vw - 32px);' +
      'background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);' +
      'font:13px/1.5 system-ui,"Segoe UI",sans-serif;color:#1f2937;overflow:hidden;' +
      'display:flex;flex-direction:column;user-select:none;';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;' +
      'background:#3b5bdb;color:#fff;cursor:move;user-select:none;';
    const title = document.createElement('span');
    title.textContent = t('wPanelTitle');
    const close = document.createElement('button');
    close.textContent = '×';
    close.type = 'button';
    close.style.cssText = 'border:0;background:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;';
    close.addEventListener('click', () => { panel.hidden = true; });
    header.append(title, close);

    const langRow = document.createElement('div');
    langRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px 0;';
    const srcSel = document.createElement('select');
    const swapBtn = document.createElement('button');
    swapBtn.textContent = '⇄';
    swapBtn.type = 'button';
    swapBtn.title = t('swapTitle');
    swapBtn.style.cssText = 'border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:14px;';
    swapBtn.addEventListener('click', swapLangs);
    const tgtSel = document.createElement('select');
    const selStyle = 'flex:1;min-width:0;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;background:#fff;';
    srcSel.style.cssText = selStyle;
    tgtSel.style.cssText = selStyle;
    langRow.append(srcSel, swapBtn, tgtSel);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;gap:8px;padding:8px 10px 0;flex:1;min-height:0;';
    const srcArea = document.createElement('textarea');
    srcArea.placeholder = t('phSource');
    const tgtArea = document.createElement('textarea');
    tgtArea.placeholder = t('phTarget');
    tgtArea.readOnly = true;
    const areaStyle =
      'flex:1;min-width:0;min-height:60px;resize:none;border:1px solid #e5e7eb;border-radius:8px;' +
      'padding:8px;font:inherit;background:#f9fafb;';
    srcArea.style.cssText = areaStyle;
    tgtArea.style.cssText = areaStyle;
    body.append(srcArea, tgtArea);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px 10px;';
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:11px;color:#9ca3af;';
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.textContent = t('panelTranslate');
    goBtn.style.cssText =
      'border:0;border-radius:8px;background:#3b5bdb;color:#fff;padding:7px 16px;cursor:pointer;font:inherit;font-size:12px;';
    goBtn.addEventListener('click', panelTranslate);
    foot.append(hint, goBtn);

    panel.append(header, langRow, body, foot);
    (document.body || document.documentElement).appendChild(panel);
    panel._els = { title, srcSel, tgtSel, srcArea, tgtArea, hint, goBtn, swapBtn, body };
    panel._detected = '';
    responsivePanelBody();

    // 右下角拖拽改尺寸（宽度/高度都记忆）
    const handle = document.createElement('div');
    handle.style.cssText =
      'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;' +
      'background:repeating-linear-gradient(315deg,#cbd5e1 0 2px,transparent 2px 6px);';
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragLockStart(e);
      const sw = panel.offsetWidth;
      const sh = panel.offsetHeight;
      const sx = e.clientX;
      const sy = e.clientY;
      const rect = panel.getBoundingClientRect();
      const onMove = (ev) => {
        if (ev.pointerType === 'mouse') ev.preventDefault();
        panel.style.width = clamp(sw + ev.clientX - sx, 320, Math.max(320, window.innerWidth - rect.left - 8)) + 'px';
        panel.style.height = clamp(sh + ev.clientY - sy, 240, Math.max(240, window.innerHeight - rect.top - 8)) + 'px';
        responsivePanelBody();
      };
      const onUp = () => {
        dragLockEnd();
        try {
          chrome.storage.local.set({ panelSize: { w: panel.offsetWidth, h: panel.offsetHeight } }).catch(() => {});
        } catch (err) {}
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    panel.appendChild(handle);

    fillPanelLangs(srcSel, true);
    fillPanelLangs(tgtSel, false);
    srcSel.addEventListener('change', () => { persistPanelLangs(); panelTranslate(); });
    tgtSel.addEventListener('change', () => { persistPanelLangs(); panelTranslate(); });
    srcArea.addEventListener('input', () => {
      clearTimeout(panelTimer);
      panelTimer = setTimeout(panelTranslate, 600);
    });

    // 拖动：按住标题栏移动
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragLockStart(e);
      const rect = panel.getBoundingClientRect();
      panelDrag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top };
      const onMove = (ev) => {
        if (!panelDrag) return;
        if (ev.pointerType === 'mouse') ev.preventDefault();
        applyPanelPos(
          panel,
          clamp(panelDrag.ox + ev.clientX - panelDrag.sx, 0, window.innerWidth - panel.offsetWidth),
          clamp(panelDrag.oy + ev.clientY - panelDrag.sy, 0, window.innerHeight - panel.offsetHeight)
        );
      };
      const onUp = () => {
        if (!panelDrag) return;
        panelDrag = null;
        dragLockEnd();
        const r = panel.getBoundingClientRect();
        try {
          chrome.storage.local.set({ panelPos: { x: Math.round(r.left), y: Math.round(r.top) } }).catch(() => {});
        } catch (err) {}
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    // 恢复上次位置和语言选择
    try {
      chrome.storage.local.get(['panelPos', 'panelSrc', 'panelTgt', 'panelSize']).then((s) => {
        if (s.panelPos && typeof s.panelPos.x === 'number') {
          applyPanelPos(panel, clamp(s.panelPos.x, 0, window.innerWidth - panel.offsetWidth), clamp(s.panelPos.y, 0, window.innerHeight - panel.offsetHeight));
        }
        if (s.panelSize && typeof s.panelSize.w === 'number') {
          panel.style.width = clamp(s.panelSize.w, 320, Math.max(320, window.innerWidth - 16)) + 'px';
          panel.style.height = clamp(s.panelSize.h, 240, Math.max(240, window.innerHeight - 16)) + 'px';
        }
        responsivePanelBody();
        if (s.panelSrc) { panelSrc = s.panelSrc; srcSel.value = panelSrc; }
        if (s.panelTgt) { panelTgt = s.panelTgt; tgtSel.value = panelTgt; }
      }).catch(() => {});
    } catch (err) {}
  }

  function togglePanel() {
    if (!panel) createPanel();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel._els.srcArea.focus();
  }

  // ---------- Messages from popup / shortcut ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === 'DS_TRANSLATE') { translatePage(document.body); startObserver(); }
    else if (msg.type === 'DS_RESTORE') restorePage();
    else if (msg.type === 'DS_TOGGLE') { translated.size ? restorePage() : (translatePage(document.body), startObserver()); }
    else if (msg.type === 'DS_RESET') {
      // 面板"重置所有数据"：清空内存缓存、还原译文，防止旧缓存被写回存储
      cache.clear();
      stopObserver();
      for (const [node, rec] of translated) { node.nodeValue = rec.orig; }
      translated.clear();
    }
    else if (msg.type === 'DS_SETTINGS') {
      const prevTarget = settings.targetLang;
      settings = Object.assign(settings, msg.settings || {});
      settings.uiLang = (!settings.uiLang || settings.uiLang === 'auto') ? aiTransDetect() : aiTransLang(settings.uiLang);
      // 目标语言变化：还原已翻译的内容，并用新语言重新翻译（否则旧译文被"已翻译"标记挡住，切换无效）
      const newTarget = msg.settings && msg.settings.targetLang;
      if (newTarget && newTarget !== prevTarget) {
        const had = translated.size > 0;
        for (const [node, rec] of translated) { node.nodeValue = rec.orig; }
        translated.clear();
        const host = location.hostname;
        const auto = settings.globalAuto || (settings.autoSites && settings.autoSites[host]);
        if (had || auto) {
          setTimeout(() => { translatePage(document.body, { silent: !had }); startObserver(); }, 300);
        }
      }
      // 语言切换后即时更新浮动按钮文案与提示
      if (widgetButtons.trans) {
        widgetButtons.trans.textContent = t('wBtnTranslate');
        widgetButtons.restore.textContent = t('wBtnRestore');
        widgetButtons.trans.title = t('wTrans') + '\n' + t('wDrag');
        widgetButtons.restore.title = t('wRestore') + '\n' + t('wDrag');
        if (widgetButtons.panel) widgetButtons.panel.title = t('wPanelTitle') + '\n' + t('wDrag');
        if (panel && panel._els) {
          panel._els.title.textContent = t('wPanelTitle');
          panel._els.srcArea.placeholder = t('phSource');
          panel._els.tgtArea.placeholder = t('phTarget');
          panel._els.goBtn.textContent = t('panelTranslate');
          panel._els.swapBtn.title = t('swapTitle');
          updateAutoOption();
          renderPanelHint(); // 已有提示（如错误）立即用新语言重渲染
        }
      }
    }
    sendResponse({ ok: true });
    return false;
  });

  // ---------- Init ----------
  (async () => {
    try {
      const s = await chrome.storage.local.get(['provider', 'model', 'targetLang', 'uiLang', 'globalAuto', 'autoSites', CACHE_KEY]);
      settings = Object.assign(settings, s);
      // 'auto' = 跟随浏览器语言（动态检测）
      settings.uiLang = (!settings.uiLang || settings.uiLang === 'auto') ? aiTransDetect() : aiTransLang(settings.uiLang);
      const obj = s[CACHE_KEY];
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          cache.set(k, v);
          if (cache.size >= CACHE_CAP) break;
        }
      }
      ensureWidget();
      const host = location.hostname;
      if (s.globalAuto || (s.autoSites && s.autoSites[host])) {
        setTimeout(() => translatePage(document.body, { silent: true }), 800);
        startObserver();
      }
    } catch (e) {}
  })();
})();
