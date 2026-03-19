# FoxVox Extended — Session Notes

## Project Overview
- **Location**: `D:\Dev\ChromePlugin-FoxVoxExtended`
- **Type**: Chrome Extension, Manifest V3
- **Build**: `npm run build` → outputs `dist/background.bundle.js`
- **Fork of**: https://github.com/Ryfter/foxvox-AE

## Architecture
| File | Role |
|------|------|
| `popup.html / popup.js` | Three-tab popup UI: Rewrite \| Bias Check \| Settings |
| `background.js` | Service worker; handles messages from popup |
| `generation.js` | Multi-provider page rewriter (CoT) |
| `bias.js` | Multi-LLM bias/fact-check analysis |
| `database.js` | IndexedDB cache for rewritten content |
| `config.json` | Rewrite templates (Fox, Vox, Humor, Conspiracy, Malicious) |

## Bias Check Feature
- User selects 2–4 providers (cloud or local), picks analysis type (Fact Check / Political / Summary)
- Popup sends `run_bias_check` message to background service worker
- Background calls `runBiasAnalysis()` from `bias.js`
- Results are injected as a **420px slide-in panel** on the right side of the active page

### Providers in `bias.js`
| Provider | Model | Notes |
|----------|-------|-------|
| OpenAI | gpt-4o | Requires `key_openai` |
| Anthropic | claude-opus-4-6 | Requires `key_anthropic` |
| Gemini | gemini-1.5-flash | Requires `key_gemini` |
| Grok | grok-2-latest | Requires `key_grok` |
| Ollama | configurable | Local, port 11434, `/api/chat` with `format: 'json'` + streaming |
| LM Studio | configurable | Local, port 1234, OpenAI-compatible `/v1/chat/completions` |

## Storage Keys (chrome.storage.local)
| Key | Value |
|-----|-------|
| `key_openai` | OpenAI API key |
| `key_anthropic` | Anthropic API key |
| `key_gemini` | Gemini API key |
| `key_grok` | Grok API key |
| `key_ollama-url` | Ollama base URL (default: `http://localhost:11434`) |
| `key_ollama-model` | Ollama model name (e.g. `phi4:14b-q8_0`) |
| `key_lmstudio-url` | LM Studio base URL (default: `http://localhost:1234`) |
| `key_lmstudio-model` | LM Studio model name |
| `openai` | Legacy key used by Rewrite module |

## Current Goal
Run a Bias Check on the Fox News article about **Iran's new Supreme Leader Mojtaba Khamenei** using **Ollama with phi4:14b-q8_0** (free/local only, no paid API keys).

## Available Ollama Models (on this machine)
- `phi4:14b-q8_0` ← **selected** (Q8_0 quantization, supported)
- `gemma3:27b-it-q4_K_M`
- `qwen3:30b`
- `phi4-reasoning:14b-q8_0`

> **Note**: `gpt-oss:20b` was previously stored as the model but uses MXFP4 quantization which Ollama does not support → HTTP 400. **Already fixed** — changed to `phi4:14b-q8_0` and saved.

## Settings Already Configured
- Ollama model set to `phi4:14b-q8_0` (confirmed by label "Ollama (phi4:14b-q8_0)" showing in Bias Check tab)
- No cloud API keys are configured or needed for this test

## Known Issues / Gotchas

### 1. Settings only save on button click
The popup saves API keys/settings **only** when the "Save Keys" button is clicked. Typing in a field and switching tabs does NOT save. Always click Save after changing settings.

### 2. Windows MCP Type tool bug
`mcp__Windows-MCP__Type` throws `name '_INPUTUnion' is not defined` when using `loc` or `label`.
**Workaround**: Use PowerShell to set clipboard → click into field → Ctrl+A → Ctrl+V.
```powershell
Set-Clipboard -Value "phi4:14b-q8_0"
```

### 3. Inference is slow
phi4:14b-q8_0 at Q8_0 quantization: **3–10 minutes per inference** on GPU, especially with LM Studio also running. Don't assume it failed — it's just slow.

### 4. Chrome service worker lifetime
Background service workers can be killed and restarted by Chrome. If the extension seems unresponsive, reload it from `chrome://extensions`.

### 5. Claude in Chrome tool can't reach Fox News window
The Claude in Chrome MCP extension is locked to its own tab group. Use **Windows MCP tools** (Snapshot, Click, Shortcut) for all Chrome UI interaction.

### 6. Results panel is transient
The 420px slide-in panel appears on the right of the Fox News page after analysis completes. It may auto-close or be dismissed. Take a screenshot promptly when it appears.

## Step-by-Step Plan to Run Bias Check

1. **Open FoxVox popup** — click the FoxVox Extended icon in Chrome toolbar (approximately x=715, y=63 in toolbar area)
2. **Navigate to Bias Check tab** — click "Bias Check" tab inside popup (~x=581, y=142)
3. **Check Ollama checkbox** — click the Ollama (phi4:14b-q8_0) checkbox (~x=450, y=307)
   - Verify no other provider checkboxes are checked (especially OpenAI — no key configured)
4. **Select analysis type** — "Fact Check" should be default; verify or select
5. **Click Run Bias Analysis** — button at bottom of popup (~x=581, y=494)
6. **Watch for activity** in the Ollama terminal window to confirm request was received
7. **Wait 3–10 minutes** for inference to complete
8. **Take snapshot** of Fox News page to check for the slide-in results panel
9. **Screenshot** the results panel showing summary, credibility badge, and expandable claim cards

## Popup Layout Reference (approximate coords)
- Toolbar FoxVox button: `(715, 63)`
- Rewrite tab: `(481, 143)`
- Bias Check tab: `(581, 142)`
- Settings tab: `(681, 142)`
- Ollama checkbox (Bias Check tab): `(450, 307)`
- Run Bias Analysis button: `(581, 494)`
- Settings → Save Keys button: roughly center-bottom of settings panel

## JSON Schema Expected from Ollama (`bias.js`)
```json
{
  "summary": "2-3 sentences on what the article claims",
  "credibility": "High|Medium|Low",
  "credibilityReason": "one sentence",
  "claims": [
    {
      "claim": "4-8 word specific assertion",
      "verdict": "likely true|likely false|mixed/disputed|unverified",
      "supporting": ["evidence..."],
      "opposing": ["counter-evidence..."],
      "assessment": "1-2 sentences",
      "deepDive": "3-4 sentences of deeper context"
    }
  ]
}
```
Ollama is called with `format: 'json'` to enforce JSON output.

## parseJSON Fallback Chain (background.js)
When Ollama returns its response, `background.js` has a `parseJSON()` function with 3 fallback strategies:
1. Direct `JSON.parse()`
2. Extract JSON from markdown fences (` ```json ... ``` `)
3. Find first `{` and last `}` and parse the substring

If all fail → error card is shown with "Could not parse response".
If parsed but `!Array.isArray(p.claims)` → error card shown (missing `claims` array).

## Files NOT to Confuse
- `bias.js` — the analysis module (what we're debugging)
- `generation.js` — the page *rewriter* (separate feature, not relevant here)
- `background.bundle.js` — the compiled output in `dist/` (don't edit this directly)
