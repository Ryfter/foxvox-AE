<!-- grimdex:start -->
<!-- grimdex:laws-version 19ec6fe832d7 -->
# Grimdex — coding rules (read first)

> Generated from Grimdex (`~/.claude/knowledge/GRIMDEX.md`) — do not edit here; the law changes
> there, and `pwsh setup.ps1 -Update` re-stamps this block. Paths below are relative to
> `~/.claude/knowledge/`. These rules outrank every other file in this repo on how code is written
> and where decisions/rules are recorded. In the law below, "here", "this file" and
> "this repo" mean **Grimdex** (`~/.claude/knowledge/`), never the repo you are reading this in.

This project's tier (its decisions and guidance): `~/.claude/knowledge/projects/foxvox-ae/`.

## The law

1. **Programming decisions, rules, and lessons are recorded HERE — not in app repos.**
   Decision records: `projects/<project-id>/decisions/dNNN-<slug>.md` (next free number;
   frontmatter `id, timestamp, project, status, confidence, revisit-if`; body **Chosen /
   Alternatives / Rationale / Feedback**). Guidance and lessons:
   `projects/<project-id>/decision-guidance.md`. App repos reference decisions by id
   — never duplicate the record.
   **Ids are project-qualified: `<prefix>-dNNN`** (e.g. `baton-d107`, `grimdex-d022`).
   Numbers are assigned per tier, so a bare `dNNN` is ambiguous across projects. The
   prefix is the project-id, or the short alias in `projects/<id>/.prefix` when that id
   is long (`canvas-toolchain` → `canvas`); prefixes must be unique. **Filenames stay
   bare `dNNN-<slug>.md`** — the folder namespaces the file, the prefix namespaces the
   *reference*. Bare `dNNN` is acceptable only inside that project's own tier.
   All id types in this ecosystem: `docs/id-conventions.md`.
2. **Grimdex holds portable coding knowledge only** — decisions, rules, and lessons any
   tool can use. Three things route elsewhere: **runtime machinery** and the user's own
   cost↔speed *stance* stay in the owning tool (origin: orchestrator d034); **durable
   context** that explains why/who but prescribes nothing goes to **Grimlore**
   `[PROVISIONAL]` (grimdex-d018) — including the hardware and model *inventory*; an
   app's **subject-matter** knowledge stays with the app (grimdex-d009).
   The line is the verb: a *constraint* is Grimdex's ("low-stakes work may not exceed the
   economy tier"), the *inventory* it references is Grimlore's ("these models exist, at
   these prices"), and the *mechanism* that enforces it at dispatch is AtomicKestrel's.
   Grimdex writes the rule; it never holds the meter.
3. **Write to your own project's tier.** Cross-project rules are not edited directly:
   propose them as candidates in `universal/promotions/<project-id>.md` (see the inbox
   README). The sweep — not you — inscribes them into this file.
4. **This file changes only through the maintained loop:** clean additions via the
   sweep with a `universal/PROMOTIONS-LOG.md` entry; removals only human-gated, with a
   `RIPPEDPAGES.md` entry. Never silently.
   **A law outranks a decision record.** Laws are global and have stood the test of time;
   decision records are project-scoped and revisable. Where the two conflict, the law
   governs. A decision may *inform* a law change only by travelling this route — never by
   contradicting one from a project tier. (Which is why law ids stay unqualified `#N`
   while decision ids are project-qualified — the form encodes the scope.)
5. **Back up everything:** commit and push your Grimdex data repo (private) before a session ends.
   Sync before you write (`git pull --rebase`) — multiple agents share this repo.
6. **Keep this repo private** — it holds personal decision history, preferences, and
   cost data.
7. **Rules trace to evidence, then escalate to enforcement.** Every rule must cite an
   observed failure or success — never write rules from anticipation (unfollowed rules
   are noise that erodes adherence to the real ones). A rule still being violated
   despite emphasis gets converted into something deterministic — a script, hook,
   gate, or CI check — not more prose.
   **Exception — provisional laws.** A new framework cannot produce evidence before it
   exists, yet it cannot function until its governing rules do. Such a rule may be
   admitted **provisionally**: maintainer-dictated (never an agent), reserved for
   structural change (a new layer, a redrawn boundary), marked `[PROVISIONAL]`, stating
   the condition that earns it permanence, and ledgered like any admission. **It binds
   exactly like a permanent law** — the mark describes its *evidence*, not its *force*.
   The audit flags any provisional law whose condition has been met (confirm it) or
   whose framework still does not exist after two cycles (reconsider it): *provisional*
   must never quietly become permanent. Ordinary rules get no such exemption.
8. **Brutally honest when queried — challenge the rules, don't flatter them.** When
   asked to evaluate a rule, decision, or line of reasoning — *especially one the asker
   authored* — surface its weaknesses plainly. No flattery, no performative agreement.
   Law #7's "aggressively maintained" has a second face: rules aren't only added and
   enforced, they're *stress-tested whenever questioned*, because a KB that ratifies weak
   reasoning to please its owner is the opposite of the place all quality stems from.
   Evidence isn't always a metric — a great decision worked through in the open is
   legitimate even when it can't be quantified — but the reasoning is always stated and
   left open to challenge. (Origin: d011.)
9. **A bare time in a scheduling request means the next model-availability window —
   never the next day.** When the operator hands `/schedule`, `CronCreate`,
   `ScheduleWakeup`, launchd/cron, or any "run it at…" ask a clock time with **no
   date** — almost always `X:11`, chosen to sit just inside a fresh Claude/Codex
   5-hour usage window — resolve it to the **soonest future occurrence**: today, if
   that time is still ahead. Never roll to tomorrow; if it has already passed today,
   say so and confirm which window is meant. Still echo the resolved local + UTC
   time back before creating (that step is unchanged) — this law fixes only the
   default. Origin: repeated operator frustration with runs scheduled a day late and
   missing their window (d041). Full detail + edge cases:
   `universal/claude-rules/scheduling.md` (always-on, also binds outside Grimdex repos).

## Routing table — when to read what

| Moment | Read |
|---|---|
| Creating/starting a new project | `universal/playbooks/project-start.md` |
| Writing outside the folder the session was opened in | `universal/playbooks/agent-scope.md` |
| Compacting a conversation (closeout + state report) | `universal/playbooks/compact.md` |
| Ending/finalizing a project | `universal/playbooks/project-end.md` |
| Taking a repo public (the publication gate) | `universal/playbooks/go-public.md` |
| Splitting work across models/tools (the labor-split) | `universal/playbooks/labor-split.md` |
| Teaching a learner as you code (learn mode + taper) | `universal/playbooks/learn-mode.md` |
| Enforcing save-before-compact (the closeout-guard hook) | `universal/playbooks/compact-guard.md` |
| Running the daily consolidation sweep | `universal/playbooks/sweep.md` |
| Running the weekly KB audit | `universal/playbooks/audit.md` |
| Bootstrapping a project's lean rule set (codebase or specs) | `universal/playbooks/rules-bootstrap.md` |
| Checking rules haven't drifted from the code (pre-merge) | `universal/playbooks/rules-drift-check.md` |
| Testing which always-on rules earn their place (ablation) | `universal/playbooks/ablate-ai-layer.md` |
| Converting a load-bearing rule into a hook (law #7) | `universal/playbooks/hooks-author.md` |
| Delegating work to a CLI agent (Grok/Codex), or verifying one | `universal/playbooks/delegating-cli.md` |
| Starting a non-trivial code item (small parcel · own worktree · fresh reviewer) | `universal/playbooks/disposable-worktrees.md` |
| Picking a model/tool for a task | `universal/routing.md` |
| User preferences and standing orders | `universal/user-prefs.md` |
<!-- grimdex:end -->

<!-- grimlore:start -->
# Grimlore — context layer (read when why/who/landscape matters)

WHY / WHO / durable context → **Grimlore** at `~/Dev/Grimlore`.
Start with `~/Dev/Grimlore/projects/foxvox-ae/index.md`.

- Authoring: `~/Dev/Grimlore/GRIMLORE.md`. Decisions still go to Grimdex.
<!-- grimlore:end -->

Handoffs: append to `docs/agent-handoffs.md` every session. Norms: `~/.claude/knowledge/projects/foxvox-ae/decision-guidance.md`.
