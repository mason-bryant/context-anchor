# Evaluating planner output with a judge LLM

## Why

The Context Bundle Planner is deterministic: it scores anchor documents against a
task and returns included/excluded sets with reasons. Quality of that selection is
hard to measure intrinsically — there is no ground-truth label baked into the
corpus. A separate LLM, given the task and the candidate bodies, can act as a
relevance judge and produce a useful per-task signal even without hand-curated
fixtures.

## How

1. Open the planner UI at `/ui`, switch to the Planner tab, enter a task (or paste
   a `planContextBundle` request-log JSON line into the task box to auto-fill
   every planner field), and click **Run Plan**.
2. Inspect the **Raw Result** panel to sanity-check the included/excluded sets
   before exporting them.
3. Click **Copy as judge prompt** next to **Suggested loadContext**. The UI
   fetches each suggested anchor body and assembles a single markdown prompt.
4. Paste the clipboard contents into your judge LLM of choice (e.g. a fresh
   Claude or GPT chat) and run it.
5. Read the JSON the judge returns: `precision_proxy`, `missed_relevant`,
   `overall_quality`, and `improvement`.

## What gets copied

The clipboard payload is a single markdown document with four blocks, in order:

1. **Task** — the planner task string, copied verbatim.
2. **Planner output JSON** — a fenced ` ```json ` block with a trimmed plan
   object: `task`, `budgetTokens`, `estimatedTokens`, `totalCandidates`,
   `included`, `excluded`, `missingContext`, and `loadContext`. Noisy fields like
   `generatedAt` are intentionally stripped to keep the prompt deterministic.
3. **Anchor body excerpts** — one `## <name>` section per anchor in
   `loadContext.names`, in order. Front matter is stripped; only the markdown
   body is included. Anchors that fail to load show `(body not available)` so
   the judge can still reason about their absence.
4. **Evaluation instructions** — a fixed rubric ending in a JSON-schema-style
   example. The judge is asked to rate each included anchor on a 0–3 scale,
   mark each excluded anchor as `yes`/`no`/`maybe`, and emit a single JSON
   object summarising the result.

## Interpreting the response

- **`precision_proxy`** — fraction of *included* anchors the judge rated `>= 2`
  (relevant or essential). Higher is better; a low value means the planner
  selected anchors the judge does not consider useful for this task.
- **`missed_relevant`** — count of *excluded* anchors the judge marked
  `should_include: "yes"`. Higher is worse; it estimates recall loss.
- **`overall_quality`** — judge's holistic 1–5 rating of the bundle.
- **`improvement`** — one-sentence suggestion (usually a task-wording or
  filter tweak) that the judge thinks would most improve the next run.

These are subjective signals, not metrics. Treat them as a fast feedback loop on
top of a single planner run, not as a regression target.

## Caveats

- **Judge bias.** Different LLMs disagree about relevance, especially on
  borderline anchors. Use the same judge across comparisons.
- **Prompt-size limits.** Smaller models may truncate large bundles. Drop the
  token budget or anchor count if the judge complains about context length.
- **Excerpts only.** The judge sees summaries plus body excerpts, not full
  project history, related milestones, or commit logs.
- **Not a substitute for fixtures.** Hand-labeled relevance fixtures remain the
  reliable way to detect regressions. Judge prompts are exploratory.

## Manual smoke test

Run this to verify the feature works end-to-end without involving an LLM:

1. Build and start the server against any anchor repo with at least two anchors:

   ```bash
   npm run build && node dist/bin/anchor-mcp.js \
     --repo <some-anchor-repo> --http --auth-token <token>
   ```

2. Open `/ui`, paste the auth token, switch to **Planner**, and run a planner
   query against any project that has at least two anchors.
3. Click **Copy as judge prompt**. The status banner should show
   `Copied judge prompt for N anchors.` where `N` matches
   `loadContext.names.length` from the Suggested loadContext panel.
4. Paste the clipboard into a scratch editor and verify:
   - The first line begins with
     `You are evaluating a deterministic context-bundle planner`.
   - There is a `# Task` block with the task you typed.
   - There is a fenced `json` block under `# Planner output` containing the
     trimmed planner JSON (and no `generatedAt`).
   - There is a `## <anchor-name>` section for every anchor in
     `loadContext.names`, each containing the actual body of that anchor
     (or `(body not available)` for anchors that failed to load).
   - There is a `# Your evaluation` section ending with the JSON schema example.

If all four checks hold, the feature is wired correctly without needing an LLM.
