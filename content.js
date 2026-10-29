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
    if (parent.closest('#' + TOAST_ID + ', #' + WIDGET_ID)) return true;
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
  let widgetButtons = { trans: null, restore: null };

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
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
    box.append(btnT, btnR);
    widgetButtons.trans = btnT;
    widgetButtons.restore = btnR;

    // Drag (>=5px counts as drag; a plain click still fires the buttons).
    // Do NOT use setPointerCapture — it retargets the click away from the buttons.
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const rect = box.getBoundingClientRect();
      widgetDrag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
      const onMove = (ev) => {
        if (!widgetDrag) return;
        const dx = ev.clientX - widgetDrag.sx;
        const dy = ev.clientY - widgetDrag.sy;
        if (!widgetDrag.moved && Math.hypot(dx, dy) > 5) {
          widgetDrag.moved = true;
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
