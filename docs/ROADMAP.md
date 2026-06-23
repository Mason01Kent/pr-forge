# PR Forge — Roadmap

Upgrade plan for the PR Forge VS Code extension, sequenced into three releases.
Each release ships something usable on its own.

Legend: file references point at `extensions/pr-forge/src/`.

---

## v0.2.0 — "Faster & re-submittable"

The two things a daily user hits first (slow feel, can't re-submit), plus cancellation.

### 1. Streaming LLM output
**Files:** `llmClient.ts`, `prGenerator.ts`, `sidebarProvider.ts`, `extension.ts`

- Add `chatCompleteStream(options, messages, onToken, signal?)`. Keep `chatComplete`
  as a thin wrapper that accumulates the stream so existing callers are unchanged.
- OpenAI-compatible: send `stream: true`, parse SSE `data: {...}` frames (`[DONE]`
  terminator), extract `choices[0].delta.content`.
- Anthropic: send `stream: true`, handle `content_block_delta` events (`delta.text`).
- Add a streaming variant of `httpRequest`; keep the buffered one for GitHub calls.
- Thread an `onToken` callback from `generatePr` up to a new
  `provider.appendPreviewToken()` so the sidebar preview fills live.
- **Gotcha:** sidebar renders pre-converted HTML. For streaming, accumulate on the
  extension side and re-render markdown on a throttle (~100ms) — reuses the existing
  `renderMarkdown` + CSP, no client-side markdown lib needed.

### 2. Update existing PR (not just create)
**Files:** `githubClient.ts`, `extension.ts`

- `findOpenPullRequest({owner, repo, head, token})` → `GET /pulls?head=owner:branch&state=open`.
- `updatePullRequest({owner, repo, number, title, body, token})` → `PATCH /pulls/{number}`.
- In `submitPrInternal`, look up an existing PR first; if found, offer
  **"Update PR #N"** vs **"Cancel"**, else current create flow.
- **Gotcha:** removes the confusing raw 422 "a pull request already exists". Draft↔ready
  toggle needs GraphQL — out of scope here; only update title/body.

### 3. Cancellation
**Files:** `llmClient.ts`, `prGenerator.ts`, `extension.ts`

- Wrap generation in `vscode.window.withProgress({ cancellable: true })`.
- `token.onCancellationRequested` → `AbortController.abort()` → `req.destroy()`.
- Check the signal between batches in `buildDiffContext`.

---

## v0.3.0 — "Better output quality"

### 4. Large-context mode (skip lossy summarize)
**Files:** `llmClient.ts`, `prGenerator.ts`, `extension.ts` (config schema)

- Add `MODEL_LIMITS` (`contextTokens`, `maxOutputTokens`); replace hardcoded
  `CHUNK_SIZE = 30_000` and `max_tokens: 4096` with budget derived from the model.
- In `buildDiffContext`, if the full diff fits the budget, pass it whole and skip
  the summarize loop.
- **Gotcha:** bump config `schemaVersion` 1→2; migrate existing `.pr-forge.json`
  by filling new fields with defaults.

### 5. Refresh model defaults + optional discovery
**Files:** `llmClient.ts`, `sidebarProvider.ts`

- Update `DEFAULT_MODELS`. Add `listModels()` (`GET /v1/models` for OpenAI-compat,
  `GET /api/tags` for Ollama; static curated list for Anthropic). Surface as a dropdown.

### 6. Regenerate-with-feedback
**Files:** `prGenerator.ts`, `sidebarProvider.ts`, `extension.ts`

- Text input + "Regenerate" in the preview view.
- `regeneratePr(opts, previousDraft, instruction)` reuses cached diff context and sends
  `[system, user(original), assistant(previousDraft), user(instruction)]`.
- Cache last `diffContext`/`testOutput` keyed by HEAD sha.

### 7. Opt-in / cached test runs
**Files:** `prGenerator.ts`, `extension.ts` (config)

- Config `runTestsOnGenerate` (default true) + sidebar toggle.
- Skip tests for title-only regens; cache output by HEAD sha for the session.

### 8. Inline review comments
**Files:** `githubClient.ts`, `prGenerator.ts`, `extension.ts`

- Review prompt emits structured JSON `{file, line, severity, comment}[]`.
- `createReview({owner, repo, number, event, comments[], token})` →
  `POST /pulls/{n}/reviews`.
- Map findings to diff right-side lines by parsing `@@` hunk headers.
- New command **"PR Forge: Post Review to GitHub"** (needs #2).
- **Gotcha:** GitHub rejects comments off-diff — validate against hunk ranges, redirect
  out-of-range findings to a general PR comment.

---

## v0.4.0 — "Infra & reach"

### 9. Unit tests
- Add test script + runner; cover pure logic first: `parseGitHubRemote`,
  `batchFileDiffs`, hunk line mapping, config migration.

### 10. ESLint
- `@typescript-eslint` recommended set; `npm run lint`.

### 11. CI
- GitHub Action: `npm ci` → lint → compile → test → `vsce package`.
- **Stop committing `out/` and `*.vsix`** — gitignore them, attach vsix to Releases.

### 12. Multi-host SCM (GitHub → GitLab/Bitbucket/Azure)
- Refactor `githubClient.ts` into an `ScmProvider` interface under `src/scm/`,
  mirroring the LLM-provider pattern. GitHub impl first, then others.

### 13. Cost/token telemetry
- Capture `usage` per response; static price table; log tokens + est. cost
  to the output channel.

---

## Suggested order & dependencies

```
v0.2.0:  #1 streaming → #3 cancellation (shares AbortController)
         #2 update-PR  (independent)
v0.3.0:  #4 large-context → #5 model refresh
         #7 test caching → #6 regen-feedback (shares draft/context cache)
         #2 ─────────────────────────────► #8 inline comments (needs PR lookup)
v0.4.0:  #9 tests, #10 lint, #11 CI (pull forward — they guard everything above)
         #12 multi-host, #13 telemetry
```
