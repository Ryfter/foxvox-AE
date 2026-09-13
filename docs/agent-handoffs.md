# Agent handoffs — FoxVox Extended

Multiple agents work this repo. Append an entry at the **top** before ending a session that changed code, data, or docs.

```markdown
## YYYY-MM-DD — <agent name>
**Did:** one line per meaningful change, with commit SHAs when committed.
**Tests:** what was run (this repo has no automated suite today).
**Decisions made:** each with one-line rationale, or "none" (record in Grimdex `projects/foxvox-ae/` when non-trivial).
**Next steps / open questions:** what you left undone.
```

## Harness pointers

| Layer | Owns | Where |
|---|---|---|
| **Grimdex** | how / rules / decisions | `~/.claude/knowledge/projects/foxvox-ae/` |
| **Grimlore** | why / who / landscape | `~/Dev/Grimlore/projects/foxvox-ae/` |
| **Baton** | what next / when | project id `foxvox-ae` · folder `ChromePlugin-FoxVoxExtended` |
| **Repo** | the extension | https://github.com/Ryfter/foxvox-AE (public) |

Shared rules live here and in the Grimdex pointer stanza. Do not copy decision records into this repo — cite `foxvox-ae-dNNN`.

## 2026-09-12 — Grok 4.6 (v4.1 OAuth + LM Studio default)

**Did:** LM Studio is the rewrite/bias default. SuperGrok and Codex device-code OAuth in the service worker. Codex Responses adapter (`originator: foxvox-extended`). Unit tests in `tests/`. `npm test` 25 pass; `npx webpack --mode production` green. Grimdex foxvox-ae-d005.

**Tests:** `npm test` — 25 pass. Webpack production build of `dist/background.bundle.js`. Did **not** dogfood SuperGrok/Codex login or a live LM Studio rewrite in Chrome.

**Decisions made:** foxvox-ae-d005 (LM Studio default + device-code SuperGrok/Codex).

**Next steps / open questions:** Reload unpacked v4.1, start LM Studio server, run a rewrite. Then try SuperGrok and Codex sign-in. GitHub issue board still empty. Historical community key still in public `config.json`.

## 2026-09-12 — Grok 4.6

**Did:** Re-ran Grimdex `wire-project.ps1 -ProjectId foxvox-ae`. Added Grimlore pointer stanzas. Seeded CHARTER, this handoff file, Grimlore bundle, Grimdex d001–d004, Baton `project.json`.

**Tests:** none (wiring only). `npm run build` not re-run this session.

**Decisions made:** foxvox-ae-d001–d004 (BYO/local keys; multi-provider fetch; bias check as a product surface; public-repo pointer-only).

**Next steps / open questions:** GitHub issue board still empty. Stateless popup still open. Historical community key still in public `config.json`. README still mostly upstream copy.
