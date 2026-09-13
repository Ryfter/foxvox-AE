# FoxVox Extended — Project Charter

_Written 2026-09-12 when the repo was wired into Grimdex / Grimlore / Baton. Public-safe: operator cost data and hostnames stay in the private knowledge repos._

## What we're building
A Manifest V3 Chrome extension that rewrites any webpage from a chosen agenda, and that can fact-check or bias-analyze the same page with several AI models side-by-side — including local Ollama and LM Studio so it can run without a paid API key.

## Who it's for
People who want to *see* how a language model can slant news, plus anyone running the demo with their own keys or a local model. Kevin maintains the public fork `Ryfter/foxvox-AE`.

## What "done" looks like
Load unpacked from this repo after `npm run build`, save a local model or a BYO cloud key in Settings, rewrite a news page, and get a bias/fact-check panel on the page. A GitHub issue board with tier labels is still missing.

## Why — the reasoning
Upstream FoxVox (Palisade Research) is a GPT-4o demo of AI content manipulation. This fork exists so the demo is actually runnable: different keys, different prompts, and a local unpaid path. See Grimlore `projects/foxvox-ae/` for the why/who; coding rules live in Grimdex `projects/foxvox-ae/`.

## Decisions & open questions
- **foxvox-ae-d001** — BYO keys / local models, not a shared community key.
- **foxvox-ae-d002** — Six providers via fetch, not OpenAI-SDK-only.
- **foxvox-ae-d003** — Bias check is a first-class surface next to rewrite.
- **foxvox-ae-d004** — Public repo carries pointer stanzas only.
- **foxvox-ae-d005** — LM Studio is the no-key default; SuperGrok and Codex use device-code OAuth.
- Open: stateless popup (UI state dies when the popup closes). Open: GitHub issues/board. Open: `config.json` still holds a historical community key in a public tree. OAuth sign-in not yet dogfooded.

---
_Baton tracks the technical run history privately under its own home; this file is yours._
