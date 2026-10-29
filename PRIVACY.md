# Privacy Policy for AI-Trans

Effective date: 2026-10-29

AI-Trans is an open-source Chrome extension. This policy explains how the extension handles data.

## Data we collect

**None.** AI-Trans does not collect, store, or transmit any personal data. There is no AI-Trans server, no telemetry, and no analytics.

## Data stored locally

Everything the extension needs is kept in your browser's local storage, on your own device:

- **API key(s)** — used only to authenticate requests to the AI provider you choose
- **Translation cache** — sentences you translated, so revisiting a page is instant and free
- **Usage statistics** — request count and token usage, counted locally
- **Settings** — provider, model, language preferences, and the floating button position

You can erase all of this at any time with the **Reset all data** button in the popup, or by uninstalling the extension.

## Data sent to third parties

When you translate a page, the text on that page is sent **directly from your browser** to the AI provider you configured (e.g. DeepSeek, OpenAI, Google Gemini), authenticated with your own API key. The provider's own terms of service and privacy policy apply. No other third party ever receives your data.

## Permissions

- **`<all_urls>` (read and change data on all websites)** — required to find the text on a page and replace it with the translation in place. Nothing is read or modified until you trigger a translation.
- **`storage`** — required to keep settings, keys, cache and statistics locally on your device.

## Contact

- Email: **xtycoc@163.com** or **rycoc@hotmail.com**
- Issues: https://github.com/ryryss/AI-Trans/issues
