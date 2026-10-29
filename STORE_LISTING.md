# Chrome Web Store listing — copy-paste material

Use these texts when submitting AI-Trans to the Chrome Web Store developer dashboard.

## Title
AI-Trans — AI Page Translator (bring your own key)

## Short description (max 132 chars)
Open-source AI page translation. Bring your own key: DeepSeek, OpenAI, Gemini, Claude or any OpenAI-compatible endpoint.

## Detailed description (English)

AI-Trans is a minimalist, open-source AI translation extension. It translates entire web pages **in place** — only the text is replaced, so the original layout, fonts, links, buttons and forms keep working exactly as before.

**One job, done well: it just translates.** No chat, no sidebar, no bloat.

Features:
- In-place page translation that preserves the page layout and interactions
- Bring your own API key — DeepSeek, OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Moonshot Kimi, Zhipu GLM, Alibaba Qwen, Groq, SiliconFlow, local Ollama, or any custom OpenAI-compatible endpoint
- Dynamic content translation — games, live feeds and infinite scroll keep translating automatically
- Draggable floating translate/restore buttons (position remembered)
- Local translation cache — revisited pages translate instantly and cost nothing
- Usage statistics — requests, input/output tokens, estimated cost, and your real DeepSeek balance via the official API
- One-click connection test and model-list fetching — never guess a model name again
- Settings auto-save; clear the key field to delete a key
- Fully localized UI in 10 languages, following your browser language by default
- Privacy-first: your key never leaves your browser except to call the provider you chose. No servers, no telemetry.

## Detailed description (简体中文)

AI-Trans 是一款极简、开源的 AI 翻译扩展。它把整个网页**原地翻译**成你的语言——只替换文字，原始排版、字体、链接、按钮和表单全部保持可用。

**只做好一件事：专注翻译。** 没有聊天、没有侧边栏、没有任何多余功能。

功能：
- 原地翻译，保留网页排版与交互
- 自带 API Key：DeepSeek、OpenAI、Google Gemini、Claude、OpenRouter、Kimi、智谱、通义千问、Groq、SiliconFlow、本地 Ollama，或任意 OpenAI 兼容接口
- 动态内容自动翻译：游戏、直播、无限滚动持续跟进
- 可拖动的浮动翻译/还原按钮（位置记忆）
- 本地翻译缓存：翻过的页面秒开、零花费
- 用量统计：请求次数、tokens、预估费用、DeepSeek 官方余额
- 一键测试连接、一键拉取模型列表，告别 404
- 设置自动保存；清空密钥框即删除密钥
- 界面支持 10 种语言，默认跟随浏览器语言
- 隐私优先：密钥除发送给你选择的服务商外不会离开本机，无服务器、无遥测

## Category
Productivity

## Screenshots (required, at least 1)
- Size: 1280×800 or 640×400
- Suggested shots: ① popup with provider settings ② a translated English page ③ the floating buttons in action

## Privacy questionnaire (developer dashboard)
- Single purpose: Translating web page content into the user's chosen language.
- Permissions justification:
  - `storage` — store API keys, settings, translation cache and statistics locally
  - `<all_urls>` — detect and replace page text in place when the user triggers translation
- Data usage: No data collected. Page text is sent only to the AI provider the user configured. Privacy policy: link the PRIVACY.md in this repository (e.g. https://github.com/ryryss/AI-Trans/blob/main/PRIVACY.md).

## Notes
- Chrome Web Store developer registration: one-time **$5** fee (Chrome Web Store developer account).
- Review after submission is manual and usually takes a few business days.
