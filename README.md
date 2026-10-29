# AI-Trans

**Open-source AI translation for Chrome. Your key, your model, zero bloat.**

AI-Trans is a minimalist Chrome extension that translates entire web pages with AI — **in place**, preserving the original layout, fonts and interactions. Unlike Chrome's built-in translator, it uses the AI model *you* choose with *your own* API key: no subscription, no middleman server, no data collection.

> One job, done well: a focused translator. No chat, no sidebar, no clutter — it just translates.

---

## 📖 中文文档

**[点击这里阅读中文使用教程（README.zh-CN.md）](./README.zh-CN.md)**

---

## ✨ Features

- **In-place page translation** — only text nodes are replaced, so layout, fonts, links, buttons and forms keep working exactly as before
- **Bring your own key** — DeepSeek, OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Moonshot Kimi, Zhipu GLM, Alibaba Qwen, Groq, SiliconFlow, and local Ollama work out of the box
- **Self-hosted & niche endpoints** — any OpenAI-compatible service works by entering your own base URL + API key + model name
- **Smart dynamic content** — games, live feeds, infinite scroll: newly rendered or rewritten text is translated automatically while you browse
- **Draggable floating buttons** — one tap to translate, one tap to restore; the position is remembered
- **Text translation panel** — a floating input box (Google-Translate style): type anything, auto-detect the source language, swap languages with one click
- **Text-to-speech** — read the source or the translation aloud with your system's local voices (free, offline, no API cost)
- **Local translation cache** — translated sentences are cached in your browser (max 20,000 entries / ~2M characters with LRU auto-eviction), so revisiting a page is instant and costs nothing
- **Usage & balance display** — request count, input/output tokens, estimated cost where official pricing is available (DeepSeek), and your real balance via the official API for supported providers (DeepSeek, OpenRouter, Moonshot, SiliconFlow)
- **Built-in diagnostics** — one-click connection test, fetch-the-model-list (kills 404s), and every error explained in plain language with a suggested fix
- **Auto-saving settings** — no "Save" button: every change is persisted instantly (clear the key field to delete a key)
- **Fully localized UI** — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, Español, Русский, Português (BR); follows your browser language by default
- **Privacy-first** — your API key never leaves your browser except to call the provider you configured; there is no AI-Trans server

## 🚀 Install

### From the Chrome Web Store
*Coming soon.*

### From a release (no git needed)
1. Download the latest `ai-trans-*.zip` from [Releases](https://github.com/ryryss/AI-Trans/releases) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped folder.
4. Pin the AI-Trans icon to your toolbar.

### From source (developers)
1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.
4. Pin the AI-Trans icon to your toolbar.

## 📖 Usage tutorial

### Step 1 — Pick a provider and enter your key
1. Click the AI-Trans icon in the toolbar.
2. Choose an **AI provider** (DeepSeek, OpenAI, Gemini, Claude, …).
3. Paste the **API key** (a link to the provider's key page is right next to the field).
4. Pick a **model** — or better, click **Fetch model list** to load the exact model names your key can use (highly recommended, this avoids 404 errors).
5. (Optional) Click **Test connection** to confirm your network can reach the provider.

> 💡 **Everything auto-saves as you type — there is no Save button.** To delete a stored key, simply empty the field. Switching providers is remembered too: change to GPT, close the popup, reopen — it stays on GPT.

### Step 2 — Translate a page
- Press **Alt+A** on any page, or click the blue floating button at the bottom-right.
- The text is replaced **in place**: layout, fonts, links and forms keep working.
- Progress and token usage appear in a toast at the bottom-right corner.

### Step 3 — Restore the original
- Click the white floating restore button, press Alt+A again, or use **Restore original** in the popup.

### Automatic translation
- **Auto-translate this site** — every page of the current site is translated on load; dynamic content (games, infinite scroll, live text) keeps translating too.
- **Auto-translate all sites** — the same, everywhere (pages already in your language are skipped automatically to avoid wasting tokens).

### Floating widget
- Draggable: hold it and move it anywhere; the position is remembered across pages.

### Text translation panel
- Click the pencil (✎) floating button to open a translation box, Google-Translate style.
- Left side: your text — translation starts automatically as you type (0.6s debounce).
- Right side: the translation (read-only).
- Top bar: source language (defaults to **Auto detect**, the detected language is shown next to it, e.g. "Auto detect (English)") ⇄ **swap** button, and the target language (defaults to your browser language).
- **Swap** exchanges both languages and texts (Google-Translate style): the old translation becomes the new source and is re-translated into the new target. If the text doesn't match the selected source language, the panel auto-detects and corrects it.
- After each translation, the bottom-left corner shows the **tokens used** — or "translated from cache (no API call)" when the same text was translated before.
- **Text-to-speech**: click 🔊 above the source or the translation to read it aloud with your system's local voices (free, offline). If a language voice isn't installed, a hint tells you to add it in your system settings.
- The window is **draggable by its title bar and resizable from its bottom-right corner**; position, size and language choices are remembered. Click × to close.

### Statistics & balance
- The popup shows **today's** and **all-time** request count and input/output tokens, counted locally.
- With DeepSeek selected, it also shows the **estimated cost** (official pricing, peak/off-peak aware).
- With a supported provider selected (**DeepSeek, OpenRouter, Moonshot, SiliconFlow**), it fetches your **real balance** from the provider's official API. Other providers (OpenAI, Gemini, Claude, …) don't expose a public balance endpoint, so no balance row is shown for them.

### Language
- The UI follows your **browser language** by default (10 languages).
- Once you pick a language in the popup, it is used **strictly everywhere** — popup, toasts, floating buttons, error messages.

### Wipe everything
- Click **Reset all data** at the bottom of the popup to clear keys, cache, statistics, settings and the widget position. Open pages are restored to their original text, and the in-memory cache of every tab is cleared too (so nothing is written back). Uninstalling the extension also clears all its data.

## 🎁 Free API keys for testing

Several providers let you test AI-Trans without spending anything:

| Provider | Free access | How to get a key |
|---|---|---|
| **Google Gemini** | Free tier, no credit card, never expires | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key. Use a Google account without billing; free models include `gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-3.6-flash` and `gemma-4-31b-it`. Tip: click **Fetch model list** in the popup to load the exact model names your key can use |
| **Groq** | Free tier with rate limits | [console.groq.com/keys](https://console.groq.com/keys) |
| **SiliconFlow** | New-user token gift | [cloud.siliconflow.cn](https://cloud.siliconflow.cn) (Chinese phone number) |
| **Zhipu GLM** | `glm-4-flash` free model | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/apikeys) (Chinese phone number) |
| **Ollama** | Totally free, runs locally | Install [Ollama](https://ollama.com), pull a model (e.g. `ollama pull qwen2.5:7b`), no key needed |

## 🔧 Custom / self-hosted endpoints

Any service that speaks the OpenAI chat-completions protocol works:

1. Select **Custom (OpenAI-compatible)** in the popup.
2. Enter the base URL (e.g. `https://your-host/v1`), your API key and the model name.
3. That's it — settings save automatically.

## 🧠 How it works

```
page text nodes → filter (skip code/inputs/hidden) → per-sentence cache lookup
    → uncached text batched (≤8,000 chars) and sent in parallel (5-way) to your model
    → JSON translations written back into the same text nodes (layout untouched)
```

A `MutationObserver` watches for new or rewritten text (`childList` + `characterData`), so dynamic content keeps translating.

## 🔒 Privacy

- No telemetry, no analytics, no external servers.
- Requests go directly from your browser to the AI provider you configured.
- Cache, settings and statistics live only in your browser's local storage.

## ❓ FAQ

- **Nothing gets translated?** Verify the API key and model; `chrome://` pages cannot be translated. Reload tabs that were open before installation. Use **Test connection** and **Fetch model list** in the popup.
- **What does a 404 (or other error) mean?** Every failure is explained in plain language with a suggested fix. Common cases: 404 → wrong Base URL or model name; 401 → invalid/expired key; 402 → insufficient balance; 403 → no access to this model; 429 → rate limit or daily free quota reached; 5xx → provider server issue, retry later; timeout/network → the provider is unreachable from your network.
- **I'm in mainland China — overseas providers fail.** Google/OpenAI/Anthropic endpoints are generally not directly reachable from mainland China. Use a proxy, or pick a domestic provider: SiliconFlow, Zhipu GLM or DeepSeek all work without one.
- **How do I delete a saved key or wipe everything?** Empty the API key field (auto-saves), or click **Reset all data** at the bottom of the popup. Uninstalling the extension also clears all data.
- **Is the translation cache limited?** Yes — per language + site it holds at most **20,000 entries or ~2 million characters** (whichever comes first) and evicts the least-recently-used entries automatically. If browser storage ever runs out of quota, the oldest half is dropped and the write retried. Usage statistics keep only the last 30 days.
- **Translation feels slow?** Use a fast non-reasoning model. DeepSeek's thinking mode is already disabled by the extension; provider-side peak hours also affect latency.

## 🤖 Credits & testing

- The code of this project was developed **with the assistance of DeepSeek V4 Pro**.
- Due to limited AI provider accounts, it has only been tested with **DeepSeek** and **Google Gemini**. Other providers follow standard OpenAI-compatible / Anthropic APIs and should work, but edge cases may exist.
- Found a problem or have a question? Email **xtycoc@163.com** or **rycoc@hotmail.com**, or [open an issue](https://github.com/ryryss/AI-Trans/issues) in this repository.

## 📄 License

Released under the [MIT License](./LICENSE). Contributions, issues and feature ideas are welcome.
