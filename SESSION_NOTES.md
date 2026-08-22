# FoxVox Extended — Complete Project Reference

## Project Overview
- **Location**: `~/dev/ChromePlugin-FoxVoxExtended`
- **Type**: Chrome Extension, Manifest V3
- **Build**: `npm run build` → webpack bundles `background.js` → `dist/background.bundle.js`
- **Fork of**: https://github.com/Ryfter/foxvox-AE
- **Upstream**: https://github.com/PalisadeResearch/foxvox

## Architecture

### File Map
| File | Role | Loaded How |
|------|------|-----------|
| `manifest.json` | Extension config, MV3 | Chrome reads directly |
| `popup.html` | Three-tab popup UI | `default_popup` in manifest |
| `popup.js` | Popup controller (ES module, `<script type="module">`) | Loaded by popup.html |
| `background.js` | Service worker — message handler hub | Bundled → `dist/background.bundle.js` |
| `generation.js` | Multi-provider page rewriter | Imported by background.js |
| `bias.js` | Multi-provider bias/fact-check analysis | Imported by background.js |
| `database.js` | IndexedDB cache for rewritten content | Imported by background.js |
| `config.json` | Rewrite templates + community OpenAI key | Fetched at runtime by popup.js |
| `webpack.config.js` | Webpack config — 3 entry points | Build tool |

### Data Flow: Bias Check
```
popup.js                    background.js (service worker)          bias.js
─────────                   ──────────────────────────────          ───────
User clicks
"Run Bias Analysis"
        │
        ├─► chrome.runtime.sendMessage({
        │     action: 'run_bias_check',
        │     id: tab.id,
        │     selectedProviders: ['ollama'],
        │     analysisType: 'factcheck',
        │     webContext: false
        │   })
        │
        │   handle_bias_check(request)
        │     │
        │     ├─► chrome.scripting.executeScript(
        │     │     collect page text + title
        │     │   )
        │     │
        │     ├─► (optional) fetchNewsContext(pageTitle)
        │     │
        │     ├─► chrome.scripting.executeScript(
        │     │     showLoadingPanel()  ← injects 380px panel
        │     │   )
        │     │
        │     ├─► chrome.storage.local.get(keys)
        │     │     → builds apiKeys object
        │     │
        │     ├─► runBiasAnalysis(providers, apiKeys, ...)  ──────►│
        │     │                                              │     │
        │     │                                              │     ├─► queryOllama()
        │     │                                              │     │     POST /api/chat
        │     │                                              │     │     stream: true
        │     │                                              │     │     format: 'json'
        │     │                                              │     │     Collects NDJSON
        │     │                                              │     │     Returns string
        │     │                                              │     │
        │     │                                              ◄─────┤
        │     │     results = [{providerId, name, color,
        │     │                  analysis: "JSON string"}]
        │     │
        │     ├─► chrome.scripting.executeScript(
        │     │     showResultsPanel(results, ...)
        │     │   )
        │     │   Inside showResultsPanel:
        │     │     parseJSON(r.analysis) → {summary, credibility,
        │     │                              credibilityReason, claims[]}
        │     │     renderProvider() builds HTML
        │     │
        │     └─► chrome.runtime.sendMessage({
        │           action: 'bias_check_completed'
        │         })
        │
        ◄─── popup receives 'bias_check_completed'
             biasStatus = "Done! See panel on the page."
```

### Data Flow: Page Rewrite
```
popup.js sends { action: 'generate', rewriteProvider, id, url }
  → background.js: process_request() → generate() async generator
    → CoT(provider, apiKeys, template, original) from generation.js
    → Each node's innerHTML rewritten and injected via chrome.scripting.executeScript
```

## Provider Configurations

### Bias Check Providers (bias.js)
| Provider | Function | Endpoint | JSON Enforcement |
|----------|----------|----------|-----------------|
| OpenAI | `queryOpenAI()` | `https://api.openai.com/v1/chat/completions` | `response_format: { type: 'json_object' }` |
| Anthropic | `queryAnthropic()` | `https://api.anthropic.com/v1/messages` | Assistant prefill `{` |
| Gemini | `queryGemini()` | `https://generativelanguage.googleapis.com/v1beta/...` | `responseMimeType: 'application/json'` |
| Grok | `queryGrok()` | `https://api.x.ai/v1/chat/completions` | `response_format: { type: 'json_object' }` |
| Ollama | `queryOllama()` | `{base}/api/chat` | `format: 'json'`, NDJSON stream |
| LM Studio | `queryLMStudio()` | `{base}/v1/chat/completions` | SSE stream, no json_object mode |

### Rewrite Providers (generation.js)
| Provider | Function | Method |
|----------|----------|--------|
| OpenAI | `rewriteWithToolUse()` | Function calling (tool_choice: required) |
| Anthropic | `rewriteAnthropic()` | Plain text + extractHTML |
| Gemini | `rewriteGemini()` | Plain text + extractHTML |
| Grok | `rewriteWithToolUse()` | Same as OpenAI (x.ai endpoint) |
| Ollama | `rewriteOllama()` | NDJSON stream + extractHTML |
| LM Studio | `rewriteWithOpenAIText()` | SSE stream + extractHTML |

## Storage Keys (chrome.storage.local)
| Key | Purpose |
|-----|---------|
| `openai` | Legacy OpenAI key (Rewrite module) |
| `key_openai` | OpenAI API key |
| `key_anthropic` | Anthropic API key |
| `key_gemini` | Gemini API key |
| `key_grok` | Grok API key |
| `key_ollama-url` | Ollama base URL (default: `http://localhost:11434`) |
| `key_ollama-model` | Ollama model name |
| `key_lmstudio-url` | LM Studio base URL (default: `http://localhost:1234`) |
| `key_lmstudio-model` | LM Studio model name |
| `template_{hostname+pathname}` | Selected rewrite template per page |

## Expected JSON Output (from all bias providers)
```json
{
  "summary": "2-3 sentences",
  "credibility": "High|Medium|Low",
  "credibilityReason": "one sentence",
  "claims": [
    {
      "claim": "4-8 word assertion",
      "verdict": "likely true|likely false|mixed/disputed|unverified",
      "supporting": ["evidence..."],
      "opposing": ["counter-evidence..."],
      "assessment": "1-2 sentences",
      "deepDive": "3-4 sentences"
    }
  ]
}
```

## parseJSON Fallback Chain (inside showResultsPanel, runs in page context)
1. `JSON.parse(text)` directly
2. Extract from markdown fences (` ```json ... ``` `)
3. Substring from first `{` to last `}`
4. Returns `null` → error card shown

## Build Process
```bash
npm run build    # webpack --mode production
# Entry points:
#   background.js → dist/background.bundle.js  (used by manifest)
#   generation.js → dist/generate.bundle.js    (not used directly)
#   database.js   → dist/database.bundle.js    (not used directly)
```
Only `dist/background.bundle.js` matters — it's the service worker.
`popup.js` is loaded directly as an ES module (NOT bundled).

## Known Issues and Gotchas

### 1. Settings only save on button click
The popup saves API keys **only** when "Save Keys" is clicked. Typing and switching tabs does NOT save.

### 2. popup.js is NOT bundled
`popup.js` runs as a raw ES module via `<script type="module">`. It does NOT import from bias.js or generation.js. It only talks to background via `chrome.runtime.sendMessage()`.

### 3. showResultsPanel runs in PAGE context
The functions `showLoadingPanel`, `showErrorPanel`, `showResultsPanel` are defined in `background.js` but executed in the **web page's context** via `chrome.scripting.executeScript()`. They cannot access any imported modules or service worker scope — they must be self-contained.

### 4. Ollama streaming collects NDJSON
Ollama returns newline-delimited JSON objects (one per line, each with `message.content`). The stream collector in `queryOllama()` concatenates all `message.content` values. The final concatenated string should be valid JSON (because `format: 'json'` was requested).

### 5. Service worker keepalive
Both `handle_bias_check` and `process_request("generate")` use a 20-second `setInterval` heartbeat via `chrome.storage.local.get('_ka')` to prevent Chrome from killing the service worker during long inference.

### 6. Article text limits
- Cloud providers: 12,000 chars
- Local providers: 20,000 chars

### 7. Dual-pass refinement (Rewrite only)
All rewrite providers use a two-pass approach: first pass generates, second pass refines with REFINE_PROMPT. Bias check is single-pass.

## Available Ollama Models (on this machine)
- `phi4:14b-q8_0` ← configured (Q8_0, supported)
- `gemma3:27b-it-q4_K_M`
- `qwen3:30b`
- `phi4-reasoning:14b-q8_0`

## Test Plan

### Manual Test: Bias Check with Ollama
1. Ensure Ollama is running (`ollama serve` or Ollama app)
2. Open any news article in Chrome (e.g., Fox News)
3. Open FoxVox popup → Settings tab → set Ollama model to `phi4:14b-q8_0` → Save Keys
4. Switch to Bias Check tab → check only "Ollama" → select "Fact Check"
5. Click "Run Bias Analysis"
6. Wait 3-10 minutes (phi4 is slow at Q8_0)
7. Verify: 380px slide-in panel appears on the right of the page
8. Verify: Summary text, credibility badge, expandable claim cards render

### Automated Test: Direct Ollama API
```bash
curl http://localhost:11434/api/tags
# Should return list of models including phi4:14b-q8_0

curl -X POST http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"phi4:14b-q8_0","messages":[{"role":"user","content":"Say hello in JSON format with a greeting field"}],"format":"json","stream":false}'
# Should return valid JSON response
```

### Debugging Tips
- Check service worker console: `chrome://extensions` → FoxVox Extended → "service worker" link
- Check page console for injected panel errors
- Look for `[FoxVox]` prefix in console logs
- If panel doesn't appear, check if `chrome.scripting.executeScript` threw an error
