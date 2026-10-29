// AI-Trans — background service worker
// Provider adapters (OpenAI-compatible + Anthropic native), token statistics, balance query.
importScripts('i18n.js');

// ---------- Provider registry ----------
// type: "openai" = OpenAI-compatible chat/completions; "anthropic" = native Claude messages API.
// All presets can be overridden by the "custom" provider (user-supplied base URL + model).
const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseURL: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', defaultModel: 'deepseek-flash', modelOptions: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'openai', name: 'OpenAI', type: 'openai', baseURL: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini', modelOptions: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'] },
  { id: 'gemini', name: 'Google Gemini', type: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', defaultModel: 'gemini-2.5-flash', modelOptions: ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemma-4-26b', 'gemini-2.0-flash'] },
  { id: 'claude', name: 'Anthropic Claude', type: 'anthropic', baseURL: 'https://api.anthropic.com/v1/messages', keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-3-5-haiku-latest', modelOptions: ['claude-3-5-haiku-latest', 'claude-haiku-4-5', 'claude-sonnet-4-5'] },
  { id: 'openrouter', name: 'OpenRouter', type: 'openai', baseURL: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', defaultModel: '', modelOptions: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'] },
  { id: 'moonshot', name: 'Moonshot Kimi', type: 'openai', baseURL: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys', defaultModel: 'moonshot-v1-8k', modelOptions: ['moonshot-v1-8k', 'kimi-latest'] },
  { id: 'zhipu', name: 'Zhipu GLM', type: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', defaultModel: 'glm-4-flash', modelOptions: ['glm-4-flash', 'glm-4.5'] },
  { id: 'qwen', name: 'Alibaba Qwen', type: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/', defaultModel: 'qwen-flash', modelOptions: ['qwen-flash', 'qwen-plus', 'qwen-turbo'] },
  { id: 'groq', name: 'Groq', type: 'openai', baseURL: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', defaultModel: 'llama-3.3-70b-versatile', modelOptions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { id: 'siliconflow', name: 'SiliconFlow', type: 'openai', baseURL: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash', modelOptions: ['deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3-Flash', 'Qwen/Qwen3.6-35B-A3B'] },
  { id: 'ollama', name: 'Ollama (local)', type: 'openai', baseURL: 'http://localhost:11434/v1', keyUrl: '', defaultModel: 'qwen2.5:7b', modelOptions: ['qwen2.5:7b', 'llama3.1:8b'], noKey: true },
  { id: 'custom', name: '', type: 'openai', baseURL: '', keyUrl: '', defaultModel: '', modelOptions: [] }
];

// ---------- Statistics ----------
const STATS_KEY = 'tokenStats';
const DAILY_KEY = 'tokenDaily';

// DeepSeek pricing (CNY per 1M tokens): [peak, off-peak]
const DEEPSEEK_PRICES = { hit: [0.04, 0.02], miss: [2, 1], out: [8, 4] };

// Beijing time Mon-Fri 9:00-12:00 / 14:00-18:00 is peak (CN public holidays treated as off-peak)
function isPeakTime() {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const h = bj.getHours();
  return (h >= 9 && h < 12) || (h >= 14 && h < 18);
}

function beijingDateKey() {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  return bj.getFullYear() + '-' + String(bj.getMonth() + 1).padStart(2, '0') + '-' + String(bj.getDate()).padStart(2, '0');
}

function calcDeepSeekCost(usage) {
  const peak = isPeakTime();
  const hit = usage.prompt_cache_hit_tokens || 0;
  const miss = Math.max(0, (usage.prompt_tokens || 0) - hit);
  const out = usage.completion_tokens || 0;
  return (hit * DEEPSEEK_PRICES.hit[peak ? 0 : 1] + miss * DEEPSEEK_PRICES.miss[peak ? 0 : 1] + out * DEEPSEEK_PRICES.out[peak ? 0 : 1]) / 1e6;
}

// ---------- Friendly error explanations ----------
// Raw HTTP codes mean nothing to most users — explain what happened and how to fix it.
function explainHTTP(status, uiLang) {
  const map = { 400: 'err400', 401: 'err401', 402: 'err402', 403: 'err403', 404: 'err404', 429: 'err429' };
  if (map[status]) return aiTransT(uiLang, map[status]);
  if (status >= 500) return aiTransT(uiLang, 'err5xx', { s: status });
  return aiTransT(uiLang, 'errHTTP', { s: status });
}

function friendlyError(e, uiLang) {
  const m = String((e && e.message) || e);
  if (m === 'EMPTY') return aiTransT(uiLang, 'errEmpty');
  if (m === 'BADJSON') return aiTransT(uiLang, 'errBadJSON');
  if (/timeout|abort/i.test(m)) return aiTransT(uiLang, 'errTimeout');
  const hm = m.match(/^HTTP (\d{3})(?:\s*·\s*)?([\s\S]*)$/);
  if (hm) {
    const base = explainHTTP(parseInt(hm[1], 10), uiLang);
    const detail = (hm[2] || '').trim();
    return detail ? base + ' · ' + detail : base;
  }
  if (/network|fetch|typeerror|enotfound|econnrefused|failed to fetch/i.test(m)) return aiTransT(uiLang, 'errNetwork');
  return m;
}

async function addUsage(usage, isDeepSeek) {
  try {
    const day = beijingDateKey();
    const s = await chrome.storage.local.get([STATS_KEY, DAILY_KEY]);
    const st = s[STATS_KEY] || { input: 0, output: 0, requests: 0, cost: 0 };
    st.input += usage.prompt_tokens || 0;
    st.output += usage.completion_tokens || 0;
    st.requests += 1;
    if (isDeepSeek) st.cost += calcDeepSeekCost(usage);
    const daily = s[DAILY_KEY] || {};
    const d = daily[day] || { input: 0, output: 0, requests: 0, cost: 0 };
    d.input += usage.prompt_tokens || 0;
    d.output += usage.completion_tokens || 0;
    d.requests += 1;
    if (isDeepSeek) d.cost += calcDeepSeekCost(usage);
    daily[day] = d;
    const keys = Object.keys(daily).sort();
    while (keys.length > 30) delete daily[keys.shift()];
    await chrome.storage.local.set({ [STATS_KEY]: st, [DAILY_KEY]: daily });
  } catch (e) {}
}

// ---------- Translation ----------
function buildSystemPrompt(targetName) {
  return [
    'You are a professional web page translation engine. The user sends a JSON object {"texts": ["...", "..."]}. Translate every string in the texts array into ' + targetName + '.',
    'Requirements:',
    '1) Output ONLY a JSON object {"translations": ["...", "..."]} whose array length exactly matches the input.',
    '2) Preserve line breaks, whitespace and punctuation style.',
    '3) Keep code, URLs, emails, numbers, names, trademarks and proper nouns unchanged.',
    '4) Translate naturally and fluently, never word-for-word.',
    '5) Return strings that are already in ' + targetName + ' unchanged.',
    '6) Output JSON only — no explanations, no markdown fences.'
  ].join('\n');
}

// Robust JSON extraction (some providers ignore response_format or wrap in fences)
function parseJSONish(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) {}
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
  }
  return {};
}

async function apiErrorDetail(resp) {
  let detail = 'HTTP ' + resp.status;
  try {
    const b = await resp.json();
    if (b && b.error) {
      if (typeof b.error === 'string') detail = b.error;
      else if (b.error.message) detail = b.error.message;
    }
  } catch (e) {}
  return detail;
}

async function callOpenAICompatible(baseURL, apiKey, model, system, userContent, extraBody) {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent }
    ]
  };
  if (extraBody) Object.assign(body, extraBody);

  const resp = await fetch(baseURL.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' · ' + (await apiErrorDetail(resp)));
  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('EMPTY');
  const usage = (data.usage || {});
  return { obj: parseJSONish(content), usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens || 0 } };
}

async function callAnthropic(baseURL, apiKey, model, system, userContent) {
  const resp = await fetch(baseURL.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 16384, system, messages: [{ role: 'user', content: userContent }] }),
    signal: AbortSignal.timeout(60000)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' · ' + (await apiErrorDetail(resp)));
  const data = await resp.json();
  const content = (data.content || []).map((b) => b && b.text ? b.text : '').join('');
  if (!content) throw new Error('EMPTY');
  const u = data.usage || {};
  return { obj: parseJSONish(content), usage: { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0, prompt_cache_hit_tokens: 0 } };
}

// Resolve the active provider configuration from settings (shared by translation & connection test)
function resolveConfig(s) {
  const provId = s.provider || 'deepseek';
  const apiKeys = s.apiKeys || {};
  const uiLang = (s.uiLang && s.uiLang !== 'auto') ? aiTransLang(s.uiLang) : aiTransDetect();
  const targetCode = s.targetLang || aiTransDefaultTarget(uiLang);
  const targetName = AI_TRANS_TARGETS[targetCode] || 'English';

  let prov, baseURL, model, apiKey, isDeepSeek = false;
  if (provId === 'custom') {
    baseURL = String(s.customBaseURL || '').trim().replace(/\/+$/, '');
    model = String(s.customModel || '').trim();
    apiKey = apiKeys.custom || '';
  } else {
    prov = PROVIDERS.find((p) => p.id === provId);
    if (!prov) prov = PROVIDERS[0];
    baseURL = prov.baseURL;
    model = s.model || prov.defaultModel;
    apiKey = apiKeys[provId] || '';
    isDeepSeek = provId === 'deepseek';
  }
  return { provId, prov, baseURL, model, apiKey, isDeepSeek, uiLang, targetName };
}

async function callAI(texts) {
  const s = await chrome.storage.local.get(['provider', 'apiKeys', 'model', 'customBaseURL', 'customModel', 'targetLang', 'uiLang']);
  const cfg = resolveConfig(s);
  const { prov, baseURL, model, apiKey, isDeepSeek, uiLang, targetName } = cfg;

  if (!baseURL) throw new Error(aiTransT(uiLang, 'errNoModel'));
  if (!apiKey && !(prov && prov.noKey)) throw new Error(aiTransT(uiLang, 'errNoKey'));
  if (!model) throw new Error(aiTransT(uiLang, 'errNoModel'));

  const system = buildSystemPrompt(targetName);
  const userContent = JSON.stringify({ texts });

  let result;
  try {
    if (prov && prov.type === 'anthropic') {
      result = await callAnthropic(baseURL, apiKey, model, system, userContent);
    } else {
      // DeepSeek: disable the thinking mode (on by default and slow/costly for translation)
      const extra = isDeepSeek ? { thinking: { type: 'disabled' } } : null;
      result = await callOpenAICompatible(baseURL, apiKey, model, system, userContent, extra);
    }
  } catch (e) {
    let msg = friendlyError(e, uiLang);
    if (/localhost|127\.0\.0\.1/.test(baseURL || '')) msg += ' · ' + aiTransT(uiLang, 'errOllama');
    throw new Error(msg);
  }

  if (!Array.isArray(result.obj.translations)) throw new Error(aiTransT(uiLang, 'errBadJSON'));
  const translations = result.obj.translations.slice();
  while (translations.length < texts.length) translations.push(null); // 缺失项置 null，内容脚本会保留原文
  return { translations, usage: result.usage, isDeepSeek, cost: isDeepSeek ? calcDeepSeekCost(result.usage) : 0 };
}

// Connection test: hit the provider's /models endpoint (read-only, cheap)
async function testConnection(config) {
  let s = config;
  if (!s) s = await chrome.storage.local.get(['provider', 'apiKeys', 'model', 'customBaseURL', 'customModel', 'targetLang', 'uiLang']);
  const cfg = resolveConfig(s);
  const { prov, baseURL, apiKey, uiLang } = cfg;
  const t0 = Date.now();
  const isAnthropic = prov && prov.type === 'anthropic';
  const headers = isAnthropic
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: 'Bearer ' + apiKey };
  const url = isAnthropic
    ? baseURL.replace(/\/messages$/, '') + '/models'
    : baseURL.replace(/\/+$/, '') + '/models';
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const latency = Date.now() - t0;
    if (!resp.ok) {
      return { ok: false, latency, error: friendlyError(new Error('HTTP ' + resp.status + ' · ' + await apiErrorDetail(resp)), uiLang) };
    }
    return { ok: true, latency };
  } catch (e) {
    return { ok: false, latency: Date.now() - t0, error: friendlyError(e, uiLang) };
  }
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'DS_API') {
    callAI(msg.texts)
      .then(({ translations, usage, isDeepSeek, cost }) => {
        addUsage(usage, isDeepSeek); // fire-and-forget
        sendResponse({ ok: true, translations, usage, cost });
      })
      .catch((e) => {
        const m = String((e && e.message) || e);
        const detail = m === 'EMPTY' ? aiTransT(aiTransDetect(), 'errEmpty') : m;
        sendResponse({ ok: false, error: detail });
      });
    return true;
  }

  if (msg.type === 'DS_PROVIDERS') {
    sendResponse({ ok: true, providers: PROVIDERS });
    return;
  }

  if (msg.type === 'DS_GET_STATS') {
    chrome.storage.local.get([STATS_KEY, DAILY_KEY]).then((s) => {
      sendResponse({ ok: true, stats: s[STATS_KEY] || {}, daily: s[DAILY_KEY] || {} });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'DS_CLEAR_STATS') {
    chrome.storage.local.remove([STATS_KEY, DAILY_KEY]).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'DS_TEST') {
    testConnection(msg.config).then((r) => sendResponse(r));
    return true;
  }

  if (msg.type === 'DS_BALANCE') {
    // Official balance endpoint — DeepSeek only, free of charge.
    chrome.storage.local.get(['provider', 'apiKeys', 'uiLang']).then(async (s) => {
      const uiLang = s.uiLang || aiTransDetect();
      if ((s.provider || 'deepseek') !== 'deepseek') return sendResponse({ ok: false, error: 'NA' });
      const key = (s.apiKeys && s.apiKeys.deepseek) || '';
      if (!key) return sendResponse({ ok: false, error: aiTransT(uiLang, 'errNoKey') });
      try {
        const resp = await fetch('https://api.deepseek.com/user/balance', {
          headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
        });
        if (!resp.ok) {
          return sendResponse({ ok: false, error: friendlyError(new Error('HTTP ' + resp.status + ' · ' + await apiErrorDetail(resp)), uiLang) });
        }
        sendResponse({ ok: true, data: await resp.json() });
      } catch (e) {
        sendResponse({ ok: false, error: friendlyError(e, uiLang) });
      }
    });
    return true;
  }
});

// Alt+A: translate / restore the current page
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-translate') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'DS_TOGGLE' }).catch(() => {});
    }
  }).catch(() => {});
});
