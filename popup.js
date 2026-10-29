// AI-Trans — popup logic (settings, provider picker, statistics, balance)
const $ = (id) => document.getElementById(id);

let uiLang = aiTransDetect();
let providers = [];
let currentHost = '';
let settings = {}; // cached snapshot

function t(key, vars) { return aiTransT(uiLang, key, vars); }

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  $('uiLangAutoOpt').textContent = t('uiLangAuto');
  // refresh provider names (custom has a localized label)
  fillProviders();
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').style.color = isError ? '#dc2626' : '#16a34a';
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtCost(c) {
  return (c < 0.01 ? c.toFixed(4) : c.toFixed(2));
}

function beijingTodayKey() {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  return bj.getFullYear() + '-' + String(bj.getMonth() + 1).padStart(2, '0') + '-' + String(bj.getDate()).padStart(2, '0');
}

// ---------- Providers ----------
function currentProvider() {
  return providers.find((p) => p.id === $('provider').value) || null;
}

function fillProviders() {
  const sel = $('provider');
  const current = sel.value;
  sel.innerHTML = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.id === 'custom' ? t('customProvider') : p.name;
    sel.appendChild(opt);
  }
  if (current && providers.some((p) => p.id === current)) sel.value = current;
  else sel.value = providers.length ? providers[0].id : '';
}

function onProviderChange() {
  const p = currentProvider();
  const isCustom = p && p.id === 'custom';
  $('customRow').hidden = !isCustom;
  // key URL link
  const ku = $('keyUrl');
  if (p && p.keyUrl) { ku.href = p.keyUrl; ku.style.display = ''; }
  else ku.style.display = 'none';
  // model options
  const dl = $('modelList');
  dl.innerHTML = '';
  if (p && p.modelOptions) {
    for (const m of p.modelOptions) {
      const o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    }
  }
  if (p) {
    $('model').placeholder = (p.id === 'custom') ? '' : (p.defaultModel || '');
    if (p.id === 'custom') {
      // 自定义服务商必须保留已填写的模型名
      $('model').value = (settings.customModel) || '';
    } else {
      // 清空输入：datalist 会按输入值过滤建议，有值就只看得到一条
      $('model').value = '';
    }
  }
  // prefill API key for this provider
  const apiKeys = settings.apiKeys || {};
  $('apiKey').value = apiKeys[p ? p.id : ''] || '';
  // balance row visibility
  $('statBalance').hidden = !(p && p.id === 'deepseek');
  if (p && p.id === 'deepseek') loadBalance();
}

// ---------- Settings ----------
async function load() {
  const s = await chrome.storage.local.get([
    'provider', 'apiKeys', 'model', 'targetLang', 'uiLang',
    'customBaseURL', 'customModel', 'globalAuto', 'autoSites'
  ]);
  settings = s;
  // 'auto' = follow the browser language dynamically
  uiLang = (s.uiLang && s.uiLang !== 'auto') ? aiTransLang(s.uiLang) : aiTransDetect();
  $('uiLang').value = s.uiLang || 'auto';

  let provResp = { providers: [] };
  try {
    provResp = await chrome.runtime.sendMessage({ type: 'DS_PROVIDERS' });
    if (provResp && provResp.providers) providers = provResp.providers;
  } catch (e) {}

  // 先建好选项，再设置选中值——否则 value 设置不生效，会一直显示第一个服务商
  fillProviders();
  $('provider').value = s.provider && providers.some((p) => p.id === s.provider) ? s.provider : (providers[0] ? providers[0].id : 'custom');
  onProviderChange();

  // 输入框保持为空（占位符显示生效模型），这样点击才能看到完整的下拉建议；
  // 自定义服务商例外：必须回显已保存的模型名
  const pNow = currentProvider();
  if (pNow && pNow.id === 'custom') {
    $('model').value = s.customModel || '';
    $('model').placeholder = '';
  } else {
    $('model').value = '';
    $('model').placeholder = s.model || (pNow ? pNow.defaultModel : '');
  }
  $('targetLang').value = s.targetLang || aiTransDefaultTarget(uiLang);
  $('baseURL').value = s.customBaseURL || '';
  $('autoGlobal').checked = !!s.globalAuto;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) {
      currentHost = new URL(tab.url).hostname;
      $('autoSite').checked = !!(s.autoSites && s.autoSites[currentHost]);
      const span = $('autoSiteLabel').querySelector('span');
      span.textContent = t('autoSite') + ' (' + currentHost + ')';
    } else {
      $('autoSite').disabled = true;
      $('autoSiteLabel').querySelector('span').textContent = t('autoSiteNA');
    }
  } catch (e) {}

  applyI18n();
}

// 自动保存：所有改动即时落盘（无"保存"按钮）；key 留空 = 清除该服务商的密钥
let saveTimer = null;

async function persistSettings() {
  const provId = $('provider').value;
  const s = await chrome.storage.local.get(['apiKeys', 'autoSites']);
  const apiKeys = s.apiKeys || {};
  const autoSites = s.autoSites || {};
  apiKeys[provId] = $('apiKey').value.trim(); // 允许空值：清空输入框即删除密钥

  const payload = {
    provider: provId,
    apiKeys,
    model: $('model').value.trim(),
    targetLang: $('targetLang').value,
    uiLang: $('uiLang').value,
    customBaseURL: $('baseURL').value.trim(),
    customModel: $('model').value.trim(),
    globalAuto: $('autoGlobal').checked
  };
  if (currentHost) {
    autoSites[currentHost] = $('autoSite').checked;
    payload.autoSites = autoSites;
  }
  await chrome.storage.local.set(payload);
  settings = Object.assign(settings, payload);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'DS_SETTINGS', settings: payload }).catch(() => {});
    }
  } catch (e) {}

  setStatus(t('saved'));
  const p = currentProvider();
  if (p && p.id === 'deepseek') loadBalance();
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSettings, 400);
}

// ---------- Statistics & balance ----------
async function loadStats() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DS_GET_STATS' });
    if (!res || !res.ok) return;
    const st = res.stats;
    const d = res.daily[beijingTodayKey()];
    if (st.requests) {
      $('statTotal').textContent =
        t('statsTotal') + ': ' + st.requests + ' ' + t('requests') + ' · ' +
        t('input') + ' ' + fmtTokens(st.input) + ' · ' + t('output') + ' ' + fmtTokens(st.output) +
        (st.cost > 0 ? ' · ' + t('estCost') + ' ¥' + fmtCost(st.cost) : '');
    }
    if (d && d.requests) {
      $('statToday').textContent =
        t('statsToday') + ': ' + d.requests + ' ' + t('requests') + ' · ' +
        fmtTokens(d.input + d.output) + ' ' + t('tokens') +
        (d.cost > 0 ? ' · ' + t('estCost') + ' ¥' + fmtCost(d.cost) : '');
    }
  } catch (e) {}
}

async function loadBalance() {
  const el = $('statBalance');
  el.hidden = false;
  el.textContent = t('balance') + ': ' + t('balanceLoading');
  el.style.color = '#4b5563';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DS_BALANCE' });
    if (!res || !res.ok) {
      if (res && res.code === 'NA') { el.hidden = true; return; }
      const msg = (res && res.code) ? aiTransErrText(uiLang, res.code, res.detail) : t('balanceFailed');
      el.textContent = t('balance') + ': ' + msg;
      el.style.color = '#dc2626';
      return;
    }
    const infos = (res.data && res.data.balance_infos) || [];
    if (!infos.length) {
      el.textContent = t('balance') + ': —';
      return;
    }
    const parts = infos.map((b) => b.currency + ' ' + b.total_balance + ' (+ ' + b.granted_balance + ')');
    el.textContent = t('balance') + ': ' + parts.join('; ');
    el.style.color = '#16a34a';
  } catch (e) {
    el.textContent = t('balance') + ': ' + t('balanceFailed');
    el.style.color = '#dc2626';
  }
}

// ---------- Actions ----------
async function sendToTab(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error('no tab');
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    setStatus(t('pageError'), true);
  }
}

// ---------- Events ----------
$('uiLang').addEventListener('change', async () => {
  const v = $('uiLang').value;
  uiLang = (v === 'auto') ? aiTransDetect() : aiTransLang(v);
  applyI18n();
  $('targetLang').value = settings.targetLang || aiTransDefaultTarget(uiLang);
  // 立即持久化：一旦用户手动选择，就严格使用该语言（不依赖保存按钮，也不回退浏览器语言）
  try {
    await chrome.storage.local.set({ uiLang: v });
    settings.uiLang = v;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'DS_SETTINGS', settings: { uiLang: v } }).catch(() => {});
    }
  } catch (e) {}
});
$('provider').addEventListener('change', () => { onProviderChange(); persistSettings(); });
$('apiKey').addEventListener('input', scheduleAutoSave);
$('apiKey').addEventListener('change', persistSettings); // 失焦立即落盘，防止输入完就关面板丢数据
$('model').addEventListener('input', scheduleAutoSave);
$('model').addEventListener('change', persistSettings);
$('baseURL').addEventListener('input', scheduleAutoSave);
$('baseURL').addEventListener('change', persistSettings);
$('targetLang').addEventListener('change', persistSettings);
$('autoSite').addEventListener('change', persistSettings);
$('autoGlobal').addEventListener('change', persistSettings);
$('testConn').addEventListener('click', async () => {
  // 用当前表单内容做连通性测试（无需先保存），直达服务商 /models 接口
  setStatus(t('testConn') + '…');
  try {
    const p = currentProvider();
    const apiKeys = {};
    apiKeys[p ? p.id : 'custom'] = $('apiKey').value.trim();
    const config = {
      provider: $('provider').value,
      apiKeys,
      model: $('model').value.trim(),
      customBaseURL: $('baseURL').value.trim(),
      customModel: $('model').value.trim(),
      uiLang: $('uiLang').value
    };
    const res = await chrome.runtime.sendMessage({ type: 'DS_TEST', config });
    if (res && res.ok) setStatus(t('connOK', { ms: res.latency }));
    else setStatus(t('connFail', { e: (res && res.code) ? aiTransErrText(uiLang, res.code, res.detail) : '' }), true);
  } catch (e) {
    setStatus(t('connFail', { e: String((e && e.message) || e) }), true);
  }
});
$('fetchModels').addEventListener('click', async (ev) => {
  ev.preventDefault();
  // 拉取当前 key 实际可用的模型列表，从真实模型名中选择（避免 404）
  setStatus(t('fetchModels') + '…');
  try {
    const p = currentProvider();
    const apiKeys = {};
    apiKeys[p ? p.id : 'custom'] = $('apiKey').value.trim();
    const config = {
      provider: $('provider').value,
      apiKeys,
      model: $('model').value.trim(),
      customBaseURL: $('baseURL').value.trim(),
      customModel: $('model').value.trim(),
      uiLang: $('uiLang').value
    };
    const res = await chrome.runtime.sendMessage({ type: 'DS_MODELS', config });
    if (!res || !res.ok) {
      setStatus(t('modelFetchFail', { e: (res && res.code) ? aiTransErrText(uiLang, res.code, res.detail) : '' }), true);
      return;
    }
    const models = res.models || [];
    // 归一化：去掉 "models/" 前缀、去重、过滤明显非对话类模型（图片/音频/embedding 等）
    const seen = new Set();
    const cleaned = [];
    for (const raw of models) {
      const id = String(raw).replace(/^models\//, '').trim();
      if (!id || seen.has(id)) continue;
      if (/embedding|tts|imagen|dall|whisper|transcri|realtime|audio|speech|image/i.test(id)) continue;
      seen.add(id);
      cleaned.push(id);
    }
    const dl = $('modelList');
    dl.innerHTML = '';
    for (const m of cleaned.slice(0, 200)) {
      const o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    }
    // 当前值不在列表里就清空，让用户点开看到完整列表后再选
    const cur = $('model').value.trim();
    if (cur && !cleaned.includes(cur)) $('model').value = '';
    $('model').placeholder =
      cleaned.find((m) => /flash-lite/i.test(m)) ||
      cleaned.find((m) => /flash/i.test(m)) ||
      cleaned[0] || '';
    setStatus(t('fetchedModels', { n: cleaned.length }));
  } catch (e) {
    setStatus(t('modelFetchFail', { e: String((e && e.message) || e) }), true);
  }
});

$('resetAll').addEventListener('click', async () => {
  if (!confirm(t('resetConfirm'))) return;
  try {
    await chrome.storage.local.clear(); // 清空密钥、缓存、统计、设置、按钮位置
    // 通知所有已打开页面：清空内存缓存并还原译文，防止旧缓存被写回存储
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'DS_RESET' }).catch(() => {});
    }
    location.reload();
  } catch (e) {}
});
$('translate').addEventListener('click', () => sendToTab('DS_TRANSLATE'));
$('restore').addEventListener('click', () => sendToTab('DS_RESTORE'));
$('clearStats').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'DS_CLEAR_STATS' });
    $('statTotal').textContent = '';
    $('statToday').textContent = '';
    setStatus(t('statsCleared'));
  } catch (e) {}
});

load().then(() => {
  loadStats();
  if (currentProvider() && currentProvider().id === 'deepseek') loadBalance();
});
