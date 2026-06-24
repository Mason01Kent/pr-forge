# Changelog

All notable changes to PR Forge are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 1.0.0

First stable release. GitHub-first, solo-developer-focused, bring-your-own-model.

### What's stable in 1.0
- **Generate PR title + body** from your `base..HEAD` diff, optional recent commits, and test output.
- **Generate PR review** — blocking issues, suggestions, security concerns, test coverage, and a recommendation, written to `.pr/PR_REVIEW.md`.
- **Regenerate body with an instruction** without re-running tests.
- **Submit / update PR to GitHub**, including draft PRs, using your VS Code GitHub sign-in (or `GITHUB_TOKEN`).
- **Post Review to PR** — opt-in: post the generated review as a single comment on the submitted PR (uses your existing GitHub token; no Copilot, no extra cost).
- **Multi-provider, BYOK** — DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama. Keys stored in VS Code SecretStorage.
- **Inline sidebar progress** — generation stays on the tools view with live step updates and a Cancel button; an activity card and view actions appear after a run.

### Scope
- **GitHub is the only supported submission target.** Non-GitHub remotes (including GitLab) are rejected with a clear message. GitLab Merge Request submission is planned for a future release.

### Hardening
- Actionable GitHub API error messages for auth (401), permissions/scope (403), not-found (404), and unprocessable (422) cases.
- Cleaner VSIX: development-only files (lint/test configs, agent docs) are excluded from the published package.

## 0.6.x (pre-1.0)

Iterative UI and workflow work leading up to 1.0:
- Sidebar redesigned to match VS Code's native look, with codicons and a compact layout.
- Inline activity area with live step updates and in-sidebar cancellation.
- View / preview actions for the generated body and review; "Open PR on GitHub" after submission.
- Model picker with live model discovery, Run Tests toggle, and Include Recent Commits toggle.
- Various fixes to API-key display, button labels, and post-run actions.
