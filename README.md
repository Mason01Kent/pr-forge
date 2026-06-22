# MasonDevTools

A collection of reusable VS Code developer tools for my projects.

Currently contains:
- **mason-pr-helper**: VS Code extension + PowerShell script for generating PR summaries and reviews using DeepSeek.

## Quick Start

### Open the workspace

```powershell
code C:\Users\codtv\Desktop\Apps\MasonDevTools\MasonDevTools.code-workspace
```

### Install extension dependencies

```powershell
cd C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\mason-pr-helper
npm install
npm run compile
```

### Run/Debug the extension locally

1. Open `MasonDevTools.code-workspace` in VS Code.
2. Press `F5` (or `Run > Start Debugging`) to launch the Extension Development Host.
3. In the new VS Code window, open any project folder.
4. Use the status bar buttons or Command Palette (`Ctrl+Shift+P`) to run MasonDevTools commands.

### Configure DeepSeek API key

Set the environment variable before launching VS Code or in your system environment:

```powershell
$env:DEEPSEEK_API_KEY = "your-api-key-here"
```

The extension reads this at runtime. The key is never stored in any project files.

### Project Config

Each target project uses a `.mason-devtools.json` file in its workspace root. Run `MasonDevTools: Initialize Project Config` from the Command Palette to generate one automatically.

Example config:

```json
{
  "schemaVersion": 1,
  "projectName": "MyProject",
  "baseBranch": "main",
  "projectType": "dotnet",
  "testCommand": "dotnet test --configuration Release",
  "outputDirectory": ".pr",
  "defaultModel": "deepseek-v4-pro",
  "reviewRulesFiles": ["README.md", "AGENTS.md"],
  "prRiskAreas": ["security", "tests", "configuration"],
  "prBodySections": [
    "Summary",
    "Why this matters",
    "Changes",
    "Tests / verification",
    "Review focus",
    "Risks / follow-ups"
  ]
}
```

### Generated files

All PR output goes into the configured `outputDirectory` (default `.pr/`):

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested PR title |
| `.pr/PR_BODY.md` | Full PR description |
| `.pr/PR_REVIEW.md` | Full PR review (only with `Generate Full PR Review`) |

### Current limitations (v1)

- No GitHub PR creation or commenting yet
- No webview UI (uses commands + output channel)
- PowerShell script requires PowerShell 5.1+
- DeepSeek API must be accessible from your machine

### Next phase

- GitHub integration (create PRs, post reviews)
- More project type detection
- Configurable prompt templates
