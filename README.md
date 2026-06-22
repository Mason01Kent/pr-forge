# PR Forge

AI-powered pull request **description** and **review** generator for VS Code.

PR Forge turns your branch diff into a polished PR title, description, and full code
review — then submits the PR to GitHub, all from a sidebar panel or the status bar.

Supports **DeepSeek**, **OpenAI**, **Anthropic**, **OpenRouter**, **Groq**, and **Ollama** (local).

## Features

- **Generate PR Body** — title + description from the `base..HEAD` diff, commits, and test output.
- **Generate Full PR Review** — structured review: blocking issues, suggestions, security, test coverage, recommendation.
- **GitHub-style preview** — rendered preview with copy / open-in-editor actions.
- **Submit PR / Submit Draft PR** — creates the PR on GitHub via the REST API.
- **Multi-provider** — switch providers any time; API keys are stored in VS Code SecretStorage, never in project files.
- **Project type detection** — auto-detects .NET, Node, React, and Python to seed sensible defaults.

## Install

**Option A — From this repo (no build required):**

Download [`extensions/pr-forge/pr-forge-0.1.0.vsix`](extensions/pr-forge/pr-forge-0.1.0.vsix) then install it in VS Code:

```
Extensions panel (Ctrl+Shift+X) → ⋯ menu → Install from VSIX…
```

Or via the CLI:

```powershell
code --install-extension extensions/pr-forge/pr-forge-0.1.0.vsix
```

**Option B — Build from source:**

```powershell
cd extensions/pr-forge
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.
See [docs/setup.md](docs/setup.md) for the full walkthrough.

## Repo layout

```
extensions/pr-forge/      VS Code extension (TypeScript)
templates/                Example PR review rule sets
docs/setup.md             Setup & troubleshooting guide
```

## Project config

Each target project gets a `.pr-forge.json` in its root (run **PR Forge: Initialize
Project Config**). It controls the base branch, provider/model, output directory,
review-rule files, risk areas, and PR body sections.

## Generated files

All output goes into the configured `outputDirectory` (default `.pr/`):

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested PR title |
| `.pr/PR_BODY.md` | Full PR description |
| `.pr/PR_REVIEW.md` | Full PR review (only with **Generate Full PR Review**) |

## License

MIT — see [LICENSE](LICENSE).
