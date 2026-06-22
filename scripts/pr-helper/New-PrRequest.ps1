<#
.SYNOPSIS
    Generates PR body, title, and optionally a full PR review using DeepSeek AI.
.DESCRIPTION
    Reads .mason-devtools.json, gathers git context, runs tests, and calls
    the DeepSeek chat completions API to produce PR content.
.PARAMETER ProjectPath
    Path to the target project root.
.PARAMETER BaseBranch
    Base branch for comparison (e.g., 'main').
.PARAMETER SkipTests
    Skip running the configured test command.
.PARAMETER GenerateReview
    Also generate a full PR review (.pr/PR_REVIEW.md).
.PARAMETER MaxDiffChars
    Maximum characters of unified diff to include in the prompt (default 80000).
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$BaseBranch,

    [switch]$SkipTests,

    [switch]$GenerateReview,

    [int]$MaxDiffChars = 80000
)

$ErrorActionPreference = 'Stop'

# ── Validate and resolve ProjectPath ───────────────────────────
if (-not (Test-Path $ProjectPath -PathType Container)) {
    Write-Error "ProjectPath does not exist or is not a directory: $ProjectPath"
    exit 1
}

$ProjectPath = Resolve-Path $ProjectPath
Write-Host "Project path resolved: $ProjectPath"

# ── Set location to project directory ──────────────────────────
Set-Location $ProjectPath
Write-Host "Working directory set: $ProjectPath"

# ── Validate git repository ────────────────────────────────────
try {
    $GitRepoRoot = git rev-parse --show-toplevel 2>$null
    if (-not $GitRepoRoot) {
        Write-Error "$ProjectPath is not inside a git repository. Run 'git init' or open a git repo."
        exit 1
    }
    $GitRepoRoot = Resolve-Path $GitRepoRoot
    Write-Host "Git repo root: $GitRepoRoot"
} catch {
    Write-Error "Failed to detect git repository: $_"
    exit 1
}

# ── Read config from repo root ─────────────────────────────────
$ConfigPath = Join-Path $GitRepoRoot '.mason-devtools.json'

if (-not (Test-Path $ConfigPath)) {
    Write-Error "Config file not found: $ConfigPath. Run 'MasonDevTools: Initialize Project Config' first."
    exit 1
}

# ── Load config ────────────────────────────────────────────────
try {
    $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse config: $_"
    exit 1
}

# ── Resolve output directory under git repo root ───────────────
$OutputDir = Join-Path $GitRepoRoot $Config.outputDirectory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
Write-Host "Output directory: $OutputDir"

# ── Check API key ──────────────────────────────────────────────
$ApiKey = $env:DEEPSEEK_API_KEY
if (-not $ApiKey) {
    Write-Error "DEEPSEEK_API_KEY environment variable is not set."
    exit 1
}

$Model = if ($Config.defaultModel) { $Config.defaultModel } else { 'deepseek-v4-pro' }

# ── Gather git context (cwd is already $ProjectPath) ───────────
try {
    # Current branch
    $CurrentBranch = git rev-parse --abbrev-ref HEAD 2>$null
    if (-not $CurrentBranch) {
        Write-Error "Not a git repository or unable to detect current branch."
        exit 1
    }
    Write-Host "Current branch: $CurrentBranch"

    # Git status
    $GitStatus = git status --short 2>$null
    Write-Host "Git status:`n$GitStatus"

    # Commits since base
    $CommitsSince = git log "$BaseBranch..HEAD" --oneline --no-merges 2>$null
    if (-not $CommitsSince) {
        $CommitsSince = git log "origin/$BaseBranch..HEAD" --oneline --no-merges 2>$null
    }
    if (-not $CommitsSince) {
        Write-Warning "No commits found since $BaseBranch. Using last 10 commits."
        $CommitsSince = git log -10 --oneline --no-merges 2>$null
    }
    Write-Host "Commits since $BaseBranch :`n$CommitsSince"

    # Changed files
    $ChangedFiles = git diff --name-status "$BaseBranch...HEAD" 2>$null
    if (-not $ChangedFiles) {
        $ChangedFiles = git diff --name-status "origin/$BaseBranch...HEAD" 2>$null
    }
    if (-not $ChangedFiles) {
        $ChangedFiles = git diff --name-status HEAD~10..HEAD 2>$null
    }
    Write-Host "Changed files:`n$ChangedFiles"

    # Diff stat
    $DiffStat = git diff --stat "$BaseBranch...HEAD" 2>$null
    if (-not $DiffStat) {
        $DiffStat = git diff --stat "origin/$BaseBranch...HEAD" 2>$null
    }
    if (-not $DiffStat) {
        $DiffStat = git diff --stat HEAD~10..HEAD 2>$null
    }
    Write-Host "Diff stat:`n$DiffStat"

    # Unified diff (truncated)
    $UnifiedDiff = git diff "$BaseBranch...HEAD" --unified=3 2>$null
    if (-not $UnifiedDiff) {
        $UnifiedDiff = git diff "origin/$BaseBranch...HEAD" --unified=3 2>$null
    }
    if (-not $UnifiedDiff) {
        $UnifiedDiff = git diff HEAD~10..HEAD --unified=3 2>$null
    }
    if ($UnifiedDiff.Length -gt $MaxDiffChars) {
        $UnifiedDiff = $UnifiedDiff.Substring(0, $MaxDiffChars)
        $UnifiedDiff += "`n`n... [diff truncated at $MaxDiffChars characters]"
    }
    Write-Host "Unified diff length: $($UnifiedDiff.Length) chars"
} catch {
    Write-Error "Failed to gather git context: $_"
    exit 1
}

# ── Review rules files ─────────────────────────────────────────
$ReviewRulesContent = ''
if ($Config.reviewRulesFiles) {
    foreach ($ruleFile in $Config.reviewRulesFiles) {
        $rulePath = Join-Path $GitRepoRoot $ruleFile
        if (Test-Path $rulePath) {
            try {
                $content = Get-Content $rulePath -Raw -ErrorAction Stop
                $ReviewRulesContent += "`n`n--- ${ruleFile} ---`n`n$content"
                Write-Host "Loaded rules: $ruleFile"
            } catch {
                Write-Warning "Could not read rules file: $ruleFile"
            }
        }
    }
}

# ── Run tests from git repo root ───────────────────────────────
$TestOutput = ''
if (-not $SkipTests -and $Config.testCommand) {
    Write-Host "Running tests: $($Config.testCommand)"
    Set-Location $GitRepoRoot
    try {
        $parts = ($Config.testCommand -split '\s+') | Where-Object { $_ -ne '' }
        $exe = $parts[0]
        $argArray = if ($parts.Count -gt 1) { $parts[1..($parts.Count - 1)] } else { @() }
        $TestOutput = & $exe @argArray 2>&1 | Out-String
        $TestExitCode = $LASTEXITCODE
        Write-Host "Tests completed (exit code: $TestExitCode)"
    } catch {
        $TestOutput = "Test execution error: $_"
        Write-Warning $TestOutput
    }
} else {
    if ($SkipTests) {
        Write-Host 'Tests skipped (--SkipTests).'
    } else {
        Write-Host 'No test command configured.'
    }
}

# ── Build prompts ──────────────────────────────────────────────
$RiskAreas = if ($Config.prRiskAreas) {
    ($Config.prRiskAreas | ForEach-Object { "- $_" }) -join "`n"
} else { '(none)' }

$prBodySections = if ($Config.prBodySections) {
    $Config.prBodySections -join "`n"
} else {
    "Summary`nChanges`nTests / verification`nReview focus`nRisks / follow-ups"
}

# ── PR Title prompt ────────────────────────────────────────────
$TitlePrompt = @"
You are a senior developer writing a pull request title.
Write a concise, professional PR title based on the following git context.
Return ONLY the title text, no markdown formatting, no quotes, no prefixes.

Project: $($Config.projectName)
Branch: $CurrentBranch
Commits:
$CommitsSince
"@

# ── PR Body prompt ─────────────────────────────────────────────
$BodyPrompt = @"
You are a senior developer writing a pull request description.
Write a comprehensive, well-structured PR body based on the git context below.
Organize the PR body using these sections:

$prBodySections

Project: $($Config.projectName)
Base branch: $BaseBranch
Branch: $CurrentBranch

Commits since $BaseBranch :
$CommitsSince

Changed files:
$ChangedFiles

Diff stat:
$DiffStat

Unified diff:
$UnifiedDiff

Test output:
$(if ($TestOutput) { $TestOutput } else { '(tests not run or no test command configured)' })
"@

if ($ReviewRulesContent) {
    $BodyPrompt += "`n`nProject review rules:$ReviewRulesContent"
}

# ── PR Review prompt ───────────────────────────────────────────
$ReviewPrompt = @"
You are a senior code reviewer. Perform a thorough code review of the following pull request changes.
Focus on the risk areas listed below. Be specific: reference file names and line numbers where possible.
Provide actionable feedback. Flag blocking issues clearly.

Risk areas to prioritize:
$RiskAreas

Project: $($Config.projectName)
Base branch: $BaseBranch
Branch: $CurrentBranch

Commits:
$CommitsSince

Changed files:
$ChangedFiles

Diff stat:
$DiffStat

Unified diff:
$UnifiedDiff

Test output:
$(if ($TestOutput) { $TestOutput } else { '(tests not run)' })
"@

if ($ReviewRulesContent) {
    $ReviewPrompt += "`n`nProject review rules:$ReviewRulesContent"
}

$ReviewPrompt += @"

Provide your review with:
1. Overall assessment (one paragraph)
2. Blocking issues (must fix before merge)
3. Important suggestions (should fix)
4. Nitpicks / style (optional)
5. Security concerns
6. Test coverage assessment
7. Summary recommendation (approve / request changes / comment)
"@

# ── Helper: Call DeepSeek API ──────────────────────────────────
function Invoke-DeepSeekChat {
    param(
        [string]$SystemPrompt,
        [string]$UserPrompt,
        [string]$ModelName = $Model
    )

    $body = @{
        model    = $ModelName
        messages = @(
            @{ role = 'system'; content = $SystemPrompt },
            @{ role = 'user'; content = $UserPrompt }
        )
        temperature = 0.3
        max_tokens  = 4096
    } | ConvertTo-Json -Depth 5

    $response = Invoke-RestMethod -Uri 'https://api.deepseek.com/chat/completions' `
        -Method Post `
        -Headers @{
            'Authorization' = "Bearer $ApiKey"
            'Content-Type'  = 'application/json'
        } `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
        -TimeoutSec 120

    return $response.choices[0].message.content
}

# ── Generate PR Title ──────────────────────────────────────────
Write-Host 'Generating PR title via DeepSeek...'
try {
    $PrTitle = Invoke-DeepSeekChat -SystemPrompt 'You are a helpful assistant that writes concise pull request titles.' -UserPrompt $TitlePrompt
    $PrTitle = $PrTitle.Trim() -replace '^["'']', '' -replace '["'']$', ''
    $titlePath = Join-Path $OutputDir 'PR_TITLE.txt'
    $PrTitle | Out-File -FilePath $titlePath -Encoding utf8
    Write-Host "PR title saved: $titlePath"
} catch {
    Write-Error "Failed to generate PR title: $_"
    exit 1
}

# ── Generate PR Body ───────────────────────────────────────────
Write-Host 'Generating PR body via DeepSeek...'
try {
    $PrBody = Invoke-DeepSeekChat -SystemPrompt 'You are a senior developer who writes excellent pull request descriptions. Use proper markdown formatting.' -UserPrompt $BodyPrompt
    $bodyPath = Join-Path $OutputDir 'PR_BODY.md'
    $PrBody | Out-File -FilePath $bodyPath -Encoding utf8
    Write-Host "PR body saved: $bodyPath"
} catch {
    Write-Error "Failed to generate PR body: $_"
    exit 1
}

# ── Generate PR Review (if requested) ──────────────────────────
if ($GenerateReview) {
    Write-Host 'Generating PR review via DeepSeek...'
    try {
        $PrReview = Invoke-DeepSeekChat -SystemPrompt 'You are a senior code reviewer. Provide thorough, actionable feedback. Use proper markdown formatting.' -UserPrompt $ReviewPrompt
        $reviewPath = Join-Path $OutputDir 'PR_REVIEW.md'
        $PrReview | Out-File -FilePath $reviewPath -Encoding utf8
        Write-Host "PR review saved: $reviewPath"
    } catch {
        Write-Error "Failed to generate PR review: $_"
        exit 1
    }
}

Write-Host 'Done.'
