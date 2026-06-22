# PR Forge Setup Guide (Windows + VS Code)

## Prerequisites

- Windows 10/11
- VS Code (latest stable)
- Node.js 18+ (for extension compilation)
- PowerShell 5.1 (included with Windows)
- Git (for repository operations)
- An API key for one AI provider: DeepSeek, OpenAI, Anthropic, OpenRouter, or Groq (or run Ollama locally, no key)

## Step 1: Clone or create the repo

```powershell
# If starting fresh:
mkdir C:\Users\codtv\Desktop\Apps\MasonDevTools
cd C:\Users\codtv\Desktop\Apps\MasonDevTools
git init
```

## Step 2: Open the workspace

```powershell
code C:\Users\codtv\Desktop\Apps\MasonDevTools\PRForge.code-workspace
```

This opens both the root and the extension folder in VS Code.

## Step 3: Install extension dependencies

```powershell
cd C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge
npm install
npm run compile
```

Verify compilation succeeds with no errors.

## Step 4: Set the AI provider API key

API keys are stored in VS Code's encrypted SecretStorage — never in project files
or environment variables.

1. Press `F5` (see Step 5) to launch the Extension Development Host.
2. Open the Command Palette (`Ctrl+Shift+P`) and run `PR Forge: Set API Key`.
3. Pick a provider (DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, or Ollama) and paste its key.
   - Ollama runs locally and needs no key.
   - Choosing a provider here also updates `provider`/`defaultModel` in `.pr-forge.json`.

## Step 5: Test the extension

1. Press `F5` in VS Code to launch the Extension Development Host.
2. In the new window, open any project folder.
3. Open the Command Palette (`Ctrl+Shift+P`).
4. Run `PR Forge: Initialize Project Config`.
5. This creates `.pr-forge.json` in the project root.

## Step 6: Generate PR content

1. Run `PR Forge: Generate PR Body` to create `.pr/PR_BODY.md` and `.pr/PR_TITLE.txt`.
2. Run `PR Forge: Generate Full PR Review` to also create `.pr/PR_REVIEW.md`.

## Step 7: Use the status bar

The status bar shows three buttons when a workspace is open:

- `$(tools) PR Forge` — opens Project Config
- `$(git-pull-request) PR Body` — generates PR body
- `$(comment-discussion) PR Review` — generates full PR review

## Troubleshooting

### "No API key set for <provider>"

Run `PR Forge: Set API Key` and select the provider configured in `.pr-forge.json`.
Keys are stored per-provider in VS Code SecretStorage.

### "No workspace folder open"

Open a project folder first (File > Open Folder).

### "No GitHub token"

Sign in to GitHub in VS Code (Accounts menu), or set a `GITHUB_TOKEN` environment
variable with `repo` scope, before running Submit PR.

### Extension doesn't compile

```powershell
cd extensions/pr-forge
npm install
npm run compile
```

Check for TypeScript errors in the Problems panel.
