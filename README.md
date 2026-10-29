# AI-Trans

**Open-source AI translation for Chrome. Your key, your model, zero bloat.**

AI-Trans is a minimalist Chrome extension that translates entire web pages with AI — **in place**, preserving the original layout, fonts and interactions. Unlike Chrome's built-in translator, it uses the AI model *you* choose with *your own* API key: no subscription, no middleman server, no data collection.

> One job, done well: a focused translator. No chat, no sidebar, no clutter — it just translates.

## ✨ Features

- **In-place page translation** — only text nodes are replaced, so layout, fonts, links, buttons and forms keep working exactly as before
- **Bring your own key** — DeepSeek, OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Moonshot Kimi, Zhipu GLM, Alibaba Qwen, Groq, and local Ollama work out of the box
- **Self-hosted & niche endpoints** — any OpenAI-compatible service works by entering your own base URL + API key + model name
- **Smart dynamic content** — games, live feeds, infinite scroll: newly rendered or rewritten text is translated automatically while you browse
- **Draggable floating buttons** — one tap to translate, one tap to restore; the position is remembered
- **Local translation cache** — translated sentences are cached in your browser, so revisiting a page is instant and costs nothing
- **Usage & balance display** — request count, input/output tokens, estimated spend (DeepSeek pricing), and your real DeepSeek balance via the official API
- **Fully localized UI** — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, Español, Русский, Português (BR); follows your browser language by default
- **Privacy-first** — your API key never leaves your browser except to call the provider you configured; there is no AI-Trans server

## 🚀 Install

### From the Chrome Web Store
*Coming soon.*

### Load unpacked (developer mode)
1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.
4. Pin the AI-Trans icon to your toolbar.

## ⚡ Quick start

1. Click the AI-Trans icon, choose your AI provider and paste your API key (a link to the provider's key page is right there).
2. Pick a model, choose the target language, save.
3. On any page press **Alt+A** — or click the floating blue button — and the page is translated in place.
4. For hands-free browsing, tick **Auto-translate this site** (or **all sites**).

Suggested budget-friendly models:

| Provider | Model | Notes |
|---|---|---|
| DeepSeek | `deepseek-flash` | cheapest; thinking mode auto-disabled for speed |
| OpenAI | `gpt-4o-mini` | solid quality, fast |
| Google | `gemini-2.5-flash` | free tier, no credit card required |
| Anthropic | `claude-3-5-haiku-latest` | fast and cheap Claude |
| Local | Ollama `qwen2.5:7b` | free, runs on your own machine |

## 🔧 Custom / self-hosted endpoints

Any service that speaks the OpenAI chat-completions protocol works:

1. Select **Custom (OpenAI-compatible)** in the popup.
2. Enter the base URL (e.g. `https://your-host/v1`), your API key and the model name.
3. Save — done.

## 📊 Usage & balance

- The popup shows requests and input/output tokens for **today** and **all time**, counted locally on your device.
- Estimated cost is computed from DeepSeek's official price list (peak/off-peak aware). Other providers count tokens only.
- With DeepSeek selected, the popup also fetches your **real balance** from the official `GET /user/balance` endpoint — free of charge, no tokens consumed.

## 🧠 How it works

```
page text nodes → filter (skip code/inputs/hidden) → per-sentence cache lookup
    → uncached text batched (≤8,000 chars) and sent in parallel (5-way) to your model
    → JSON translations written back into the same text nodes (layout untouched)
```

A `MutationObserver` watches for new or rewritten text (`childList` + `characterData`), so dynamic content keeps translating.

## 🎁 Free API keys for testing

Several providers let you test AI-Trans without spending anything:

| Provider | Free access | How to get a key |
|---|---|---|
| **Google Gemini** | Free tier, no credit card, never expires | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key. Use a Google account without billing; models like `gemini-2.5-flash` / `gemini-3.1-flash-lite` have generous daily quotas |
| **Groq** | Free tier with rate limits | [console.groq.com/keys](https://console.groq.com/keys) |
| **SiliconFlow** | New-user token gift | [cloud.siliconflow.cn](https://cloud.siliconflow.cn) (Chinese phone number) |
| **Zhipu GLM** | `glm-4-flash` free model | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/apikeys) (Chinese phone number) |
| **Ollama** | Totally free, runs locally | Install [Ollama](https://ollama.com), pull a model (e.g. `ollama pull qwen2.5:7b`), no key needed |

## 🔒 Privacy

- No telemetry, no analytics, no external servers.
- Requests go directly from your browser to the AI provider you configured.
- Cache, settings and statistics live only in your browser's local storage.

## ❓ FAQ

- **Nothing gets translated?** Verify the API key and model; `chrome://` pages cannot be translated. Reload tabs that were open before installation.
- **What does a 404 (or other error) mean?** Every failure is explained in plain language with a suggested fix. Common cases: 404 → wrong Base URL or model name; 401 → invalid/expired key; 402 → insufficient balance; 429 → rate limit or daily free quota reached; 5xx → provider server issue, retry later.
- **Translation feels slow?** Use a fast non-reasoning model. DeepSeek's thinking mode is already disabled by the extension; provider-side peak hours also affect latency.
- **Can I use a local model?** Yes — pick **Ollama (local)** or any self-hosted OpenAI-compatible endpoint.

## 📄 License

Released under the [MIT License](./LICENSE). Contributions, issues and feature ideas are welcome.
