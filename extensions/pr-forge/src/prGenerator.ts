import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { chatComplete, chatCompleteStream, getModelLimits, LLMClientOptions, UsageStats } from './llmClient';
import { Finding, FileDiff, annotateDiff, parseFindingsJson } from './reviewComments';

export interface PrGeneratorOptions {
  workspacePath: string;
  baseBranch: string;
  includeRecentCommits: boolean;
  /** When true, append an AI-summarised "## Commits" table to the PR body. */
  includeCommitSummaries: boolean;
  /** When true, append an AI-summarised "## Changes" per-file walkthrough table. */
  includeFileWalkthrough: boolean;
  outputDirectory: string;
  projectName: string;
  prRiskAreas: string[];
  prBodySections: string[];
  reviewRulesFiles: string[];
  testCommand: string;
  generateReview: boolean;
  /** When false, skip running tests (use cached output if available). */
  runTests: boolean;
  llm: LLMClientOptions;
  onLog: (msg: string) => void;
  /** Cancels the in-flight LLM/test work when aborted. */
  signal?: AbortSignal;
  /** Receives incremental text deltas of the primary output (body or review). */
  onToken?: (delta: string) => void;
}

export interface PrGeneratorResult {
  title: string;
  body: string;
  review?: string;
  outputDir: string;
  branch: string;
  headSha: string;
  usage: UsageStats;
}

// Generated/noisy files processed last so source files always fit first.
const NOISY_PATTERNS = /\.(lock|min\.js|min\.css|map|snap|Designer\.cs|g\.cs)$|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Migrations\/.*\.cs$/i;

// Session-level cache: keyed by headSha, stores diffContext and testOutput.
interface DiffCache {
  headSha: string;
  diffContext: string;
  testOutput: string;
  /** Cached generated tables (depend only on headSha), reused on regenerate. */
  commitTable?: string;
  fileTable?: string;
}
let _diffCache: DiffCache | null = null;

export function clearDiffCache(): void { _diffCache = null; }

/** Markers that delimit auto-generated tables so they can be stripped on regenerate. */
const FILES_MARKER = '<!-- pr-forge:files -->';
const COMMITS_MARKER = '<!-- pr-forge:commits -->';
const MAX_SUMMARISED_COMMITS = 40;
const MAX_WALKTHROUGH_FILES = 40;

/** Make a string safe for a single markdown table cell. */
function tableCell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Remove any previously appended PR Forge tables (files/commits) and trailing whitespace. */
function stripGeneratedTables(body: string): string {
  const indices = [body.indexOf(FILES_MARKER), body.indexOf(COMMITS_MARKER)].filter(i => i !== -1);
  if (indices.length === 0) { return body; }
  return body.slice(0, Math.min(...indices)).replace(/\n+$/, '');
}

/** Parse the model's JSON array of {sha, summary} into a sha->summary map (defensive). */
function parseCommitSummaries(text: string): Record<string, string> {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) { return {}; }
    const arr = JSON.parse(match[0]) as Array<{ sha?: string; summary?: string }>;
    const out: Record<string, string> = {};
    for (const item of arr) {
      if (item && typeof item.sha === 'string' && typeof item.summary === 'string') {
        out[item.sha.trim()] = item.summary.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Build an AI-summarised "## Commits" table for base..HEAD in a single LLM call.
 * Returns '' when there are no commits. Plain short SHAs auto-link on GitHub.
 */
async function buildCommitTable(
  opts: PrGeneratorOptions,
  cwd: string,
): Promise<string> {
  const raw = safeExec(`git log ${opts.baseBranch}..HEAD --pretty=format:%h%x1f%s`, cwd).trim();
  if (!raw) { return ''; }

  let commits = raw.split('\n').map(line => {
    const parts = line.split('\x1f');
    return { sha: (parts[0] ?? '').trim(), subject: (parts.slice(1).join('\x1f') ?? '').trim() };
  }).filter(c => c.sha);
  if (commits.length === 0) { return ''; }

  let truncationNote = '';
  if (commits.length > MAX_SUMMARISED_COMMITS) {
    truncationNote = `\n\n_Showing the ${MAX_SUMMARISED_COMMITS} most recent of ${commits.length} commits._`;
    commits = commits.slice(0, MAX_SUMMARISED_COMMITS);
  }

  const context = commits.map(c => {
    const files = safeExec(`git diff-tree --no-commit-id --name-only -r ${c.sha}`, cwd)
      .trim().split('\n').filter(Boolean);
    const fileList = files.slice(0, 12).join(', ') + (files.length > 12 ? `, +${files.length - 12} more` : '');
    return `${c.sha} | ${c.subject}\nfiles: ${fileList || '(none)'}`;
  }).join('\n\n');

  opts.onLog(`Summarising ${commits.length} commit(s)...`);
  const response = await chatComplete(opts.llm, [
    { role: 'system', content: `You summarise git commits for the ${opts.projectName} project. Output strict JSON only — no prose, no code fences.` },
    {
      role: 'user',
      content: `For each commit below, write ONE concise sentence (max ~15 words, plain past tense) describing what it does.
Return ONLY a JSON array, one object per commit in the same order:
[{"sha":"<sha>","summary":"<one sentence>"}]

Commits:
${context}`,
    },
  ], opts.signal);

  const summaries = parseCommitSummaries(response);
  const rows = commits.map(c => `| ${c.sha} | ${tableCell(summaries[c.sha] ?? c.subject)} |`).join('\n');
  return `${COMMITS_MARKER}\n## Commits\n\n| Commit | Summary |\n| --- | --- |\n${rows}${truncationNote}`;
}

/** Build an AI-summarised "## Changes" per-file walkthrough table in a single LLM call. */
async function buildFileWalkthroughTable(opts: PrGeneratorOptions, cwd: string): Promise<string> {
  let fileDiffs = getFileDiffs(cwd, opts.baseBranch).filter(f => f.diff.trim());
  if (fileDiffs.length === 0) { return ''; }

  let truncationNote = '';
  if (fileDiffs.length > MAX_WALKTHROUGH_FILES) {
    truncationNote = `\n\n_Showing ${MAX_WALKTHROUGH_FILES} of ${fileDiffs.length} changed files._`;
    fileDiffs = fileDiffs.slice(0, MAX_WALKTHROUGH_FILES);
  }

  const context = fileDiffs.map(f => {
    const snippet = f.diff.length > 1500 ? f.diff.slice(0, 1500) + '\n[...]' : f.diff;
    return `### ${f.file}\n${snippet}`;
  }).join('\n\n');

  opts.onLog(`Summarising ${fileDiffs.length} changed file(s)...`);
  const response = await chatComplete(opts.llm, [
    { role: 'system', content: `You summarise file changes for the ${opts.projectName} project. Output strict JSON only — no prose, no code fences.` },
    {
      role: 'user',
      content: `For each changed file below, write ONE concise sentence (max ~15 words) describing what changed in it.
Return ONLY a JSON array, one object per file in the same order:
[{"file":"<path>","summary":"<one sentence>"}]

${context}`,
    },
  ], opts.signal);

  let summaries: Record<string, string> = {};
  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      for (const item of JSON.parse(match[0]) as Array<{ file?: string; summary?: string }>) {
        if (item && typeof item.file === 'string' && typeof item.summary === 'string') {
          summaries[item.file.trim()] = item.summary.trim();
        }
      }
    }
  } catch { summaries = {}; }

  const rows = fileDiffs.map(f => `| \`${tableCell(f.file)}\` | ${tableCell(summaries[f.file] ?? 'Changed')} |`).join('\n');
  return `${FILES_MARKER}\n## Changes\n\n| File | Summary |\n| --- | --- |\n${rows}${truncationNote}`;
}

/** Append the enabled generated tables (file walkthrough, then commits) to the body. */
async function appendGeneratedTables(opts: PrGeneratorOptions, cwd: string, headSha: string, body: string): Promise<string> {
  const cached = _diffCache && _diffCache.headSha === headSha ? _diffCache : null;
  let result = stripGeneratedTables(body).replace(/\n+$/, '');

  if (opts.includeFileWalkthrough) {
    let table = cached?.fileTable ?? '';
    if (!table) {
      table = await buildFileWalkthroughTable(opts, cwd);
      if (cached) { cached.fileTable = table; }
    } else { opts.onLog('Using cached file walkthrough.'); }
    if (table) { result += `\n\n${table}`; }
  }

  if (opts.includeCommitSummaries) {
    let table = cached?.commitTable ?? '';
    if (!table) {
      table = await buildCommitTable(opts, cwd);
      if (cached) { cached.commitTable = table; }
    } else { opts.onLog('Using cached commit summaries.'); }
    if (table) { result += `\n\n${table}`; }
  }

  return result;
}

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 15000 }).toString();
  } catch {
    return '';
  }
}

/**
 * Per-file unified diffs for base..HEAD, source files first and generated/noisy
 * files last. Shared by PR generation and inline-review anchoring.
 */
export function getFileDiffs(cwd: string, baseBranch: string): { file: string; diff: string }[] {
  const nameStatus = safeExec(`git diff --name-status ${baseBranch}..HEAD`, cwd);
  const allFiles = nameStatus.split('\n').filter(Boolean).map(l => l.split('\t').pop() ?? '');
  const ordered = [
    ...allFiles.filter(f => !NOISY_PATTERNS.test(f)),
    ...allFiles.filter(f => NOISY_PATTERNS.test(f)),
  ];
  return ordered.map(file => ({
    file,
    diff: safeExec(`git diff ${baseBranch}..HEAD -- "${file}"`, cwd),
  }));
}

function runTestCommand(opts: PrGeneratorOptions): Promise<string> {
  return new Promise((resolve) => {
    if (!opts.testCommand.trim()) {
      resolve('(no test command configured)');
      return;
    }
    const parts = opts.testCommand.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const proc = spawn(cmd, args, { cwd: opts.workspacePath, shell: true });
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(stdout.concat(stderr).map((b) => b.toString()).join('') + '\n\n[Test timed out after 120s]');
    }, 120_000);
    proc.stdout?.on('data', (data: Buffer) => stdout.push(data));
    proc.stderr?.on('data', (data: Buffer) => stderr.push(data));
    proc.on('close', (code) => {
      clearTimeout(timeout);
      const output = stdout.concat(stderr).map((b) => b.toString()).join('');
      resolve(output + (code !== 0 ? `\n\n[Test exited with code ${code}]` : ''));
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`[Failed to run test command: ${err.message}]`);
    });
  });
}

/**
 * Split an array of per-file diffs into batches, each fitting within chunkSize.
 * A single file larger than chunkSize gets its own batch, truncated with a note.
 * Exported for testing.
 */
export function batchFileDiffs(fileDiffs: { file: string; diff: string }[], chunkSize: number): string[] {
  const batches: string[] = [];
  let current = '';
  for (const { file, diff } of fileDiffs) {
    const entry = diff.length > chunkSize
      ? diff.slice(0, chunkSize) + `\n\n[...diff for ${file} truncated at ${chunkSize} chars]`
      : diff;
    if (current.length + entry.length > chunkSize && current.length > 0) {
      batches.push(current);
      current = entry;
    } else {
      current += entry;
    }
  }
  if (current.length > 0) { batches.push(current); }
  return batches;
}

/**
 * If the full diff fits within the model's input budget, return it directly
 * (no lossy summarization). Otherwise, summarise each batch and combine.
 */
async function buildDiffContext(
  fileDiffs: { file: string; diff: string }[],
  llm: LLMClientOptions,
  projectName: string,
  onLog: (msg: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const limits = getModelLimits(llm.model);
  // Reserve ~20k chars for prompt wrapper + output; rest is available for the diff.
  const promptOverhead = 20_000;
  const budget = Math.max(limits.inputBudgetChars - promptOverhead, 30_000);

  const fullDiff = fileDiffs.map(f => f.diff).join('');
  if (fullDiff.length <= budget) {
    onLog(`Diff fits in one pass (${fullDiff.length.toLocaleString()} chars, budget ${budget.toLocaleString()}).`);
    return fullDiff;
  }

  // Diff is too large — summarise in batches
  const chunkSize = Math.min(30_000, Math.floor(budget / 4));
  const batches = batchFileDiffs(fileDiffs, chunkSize);
  onLog(`Diff too large for one pass (${fullDiff.length.toLocaleString()} chars) — summarising ${batches.length} batches...`);
  const summaries: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) { throw new Error('Request cancelled'); }
    onLog(`  Summarising batch ${i + 1} of ${batches.length}...`);
    const summary = await chatComplete(llm, [
      {
        role: 'system',
        content: `You are a senior software engineer analysing a partial diff for the ${projectName} project.`,
      },
      {
        role: 'user',
        content: `Summarise the following code changes concisely. Focus on WHAT changed and WHY it matters. Be specific about function names, classes, and logic changes. Do not pad.\n\n${batches[i]}`,
      },
    ], signal);
    summaries.push(`### Batch ${i + 1} summary\n${summary}`);
  }
  return summaries.join('\n\n');
}

/**
 * Generate structured, line-anchored review findings from per-file diffs in a
 * single LLM call. Diffs are annotated with new-file line numbers so the model
 * references exact lines. Returns [] on parse failure (caller degrades gracefully).
 */
export async function generateInlineFindings(
  llm: LLMClientOptions,
  fileDiffs: FileDiff[],
  projectName: string,
  onLog: (msg: string) => void,
  signal?: AbortSignal,
): Promise<Finding[]> {
  const annotated = fileDiffs
    .filter(f => f.diff.trim())
    .map(f => `### ${f.file}\n${annotateDiff(f.diff)}`)
    .join('\n\n');
  if (!annotated.trim()) { return []; }

  const limits = getModelLimits(llm.model);
  const budget = Math.max(limits.inputBudgetChars - 20_000, 30_000);
  const context = annotated.length > budget ? annotated.slice(0, budget) + '\n[...diff truncated]' : annotated;

  onLog('Generating inline review findings...');
  const response = await chatComplete(llm, [
    { role: 'system', content: `You are a senior engineer reviewing a diff for the ${projectName} project. Output strict JSON only — no prose, no code fences.` },
    {
      role: 'user',
      content: `Review the annotated diff below. Each changed line is prefixed with "<lineNumber>\\t" giving its line number in the NEW file. Report only real, specific issues (bugs, security, correctness, clear improvements).

Return ONLY a JSON array, one object per finding:
[{"file":"<path>","line":<new-file line number>,"severity":"blocking|suggestion|nit|security","comment":"<one concise sentence>","suggestion":"<optional: replacement for exactly that one line>"}]

Use the exact line numbers shown. Omit "suggestion" unless it replaces exactly that single line. If there are no issues, return [].

${context}`,
    },
  ], signal);

  return parseFindingsJson(response);
}

export async function generatePr(opts: PrGeneratorOptions): Promise<PrGeneratorResult> {
  const cwd = opts.workspacePath;
  const branch = safeExec('git rev-parse --abbrev-ref HEAD', cwd).trim() || '(unknown branch)';
  const headSha = safeExec('git rev-parse HEAD', cwd).trim();
  const commits = opts.includeRecentCommits ? safeExec(`git log ${opts.baseBranch}..HEAD --oneline`, cwd) : '';
  const diffStat = safeExec(`git diff --stat ${opts.baseBranch}..HEAD`, cwd);
  const files    = safeExec(`git diff --name-status ${opts.baseBranch}..HEAD`, cwd);

  opts.onLog(`Branch: ${branch}`);
  if (opts.includeRecentCommits) {
    opts.onLog(`Commits: ${commits.split('\n').filter(Boolean).length}`);
  } else {
    opts.onLog('Commits: skipped');
  }

  let diffContext: string;
  let testOutput: string;

  if (_diffCache && _diffCache.headSha === headSha) {
    opts.onLog('Using cached diff context and test output.');
    diffContext = _diffCache.diffContext;
    testOutput = _diffCache.testOutput;
  } else {
    // Collect per-file diffs — source files first, generated files last
    const fileDiffs = getFileDiffs(cwd, opts.baseBranch);
    opts.onLog(`Files changed: ${fileDiffs.length}`);

    diffContext = await buildDiffContext(fileDiffs, opts.llm, opts.projectName, opts.onLog, opts.signal);

    // Test output
    if (opts.runTests) {
      opts.onLog('Running tests...');
      const rawTestOutput = await runTestCommand(opts);
      const TEST_CAP = 6_000;
      testOutput = rawTestOutput.length <= TEST_CAP
        ? rawTestOutput
        : `[...showing last ${TEST_CAP} chars — failures appear at end...]\n\n` + rawTestOutput.slice(-TEST_CAP);
      opts.onLog('Tests completed.');
    } else {
      opts.onLog('Skipping tests (runTestsOnGenerate is off).');
      testOutput = '(tests skipped)';
    }

    _diffCache = { headSha, diffContext, testOutput };
  }

  // Load review rules
  const limits = getModelLimits(opts.llm.model);
  const ruleCapPerFile = Math.floor(Math.min(30_000, limits.inputBudgetChars / 8));
  const ruleParts: string[] = [];
  for (const rulesFile of opts.reviewRulesFiles) {
    try {
      const fullPath = path.join(opts.workspacePath, rulesFile);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (content.length > ruleCapPerFile) {
          content = content.slice(0, ruleCapPerFile) + `\n\n[...${rulesFile} truncated]`;
        }
        ruleParts.push(`--- ${rulesFile} ---\n${content}`);
      }
    } catch { /* skip */ }
  }
  const reviewRules = ruleParts.join('\n\n---\n\n');

  const systemPrompt = `You are a senior software engineer writing a GitHub pull request for the ${opts.projectName} project.
Be specific, accurate, and concise. Use markdown formatting.`;

  const budget = Math.max(limits.inputBudgetChars - 20_000, 30_000);
  const diffLabel = diffContext.length > budget * 0.8 ? 'Diff summaries' : 'Diff';

  // Generate PR title (non-streaming — short response, no live preview needed)
  opts.onLog('Generating PR title...');
  const title = await chatComplete(opts.llm, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Generate a concise PR title (under 72 characters) for these changes:

Branch: ${branch}
${opts.includeRecentCommits ? `Commits:\n${commits}\n` : ''}

Changed files:
${files}

Respond with ONLY the title text. No quotes, no markdown, no explanation.`,
    },
  ], opts.signal);
  const cleanTitle = title.replace(/^["']|["']$/g, '').trim();
  opts.onLog(`Title: ${cleanTitle}`);

  const totalUsage: UsageStats = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  function accumulateUsage(u: UsageStats): void {
    totalUsage.inputTokens  += u.inputTokens;
    totalUsage.outputTokens += u.outputTokens;
    if (u.estimatedCostUsd !== undefined) {
      totalUsage.estimatedCostUsd = (totalUsage.estimatedCostUsd ?? 0) + u.estimatedCostUsd;
    }
  }

  // Generate PR body — stream tokens to onToken so the sidebar preview fills live
  opts.onLog('Generating PR body...');
  let body = '';
  const bodyUsage = await chatCompleteStream(opts.llm, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Write a pull request description with these sections: ${opts.prBodySections.join(', ')}.

Branch: ${branch}
Base branch: ${opts.baseBranch}

${opts.includeRecentCommits ? `Commits:\n${commits}\n` : ''}

Changed files:
${diffStat}

${diffLabel}:
${diffContext}

Test output:
${testOutput}

${reviewRules ? 'Review rules:\n' + reviewRules : ''}

Risk areas to highlight: ${opts.prRiskAreas.join(', ')}

Write in markdown. Be specific about what changed and why.`,
    },
  ], (delta) => {
    body += delta;
    opts.onToken?.(delta);
  }, opts.signal);
  accumulateUsage(bodyUsage);
  opts.onLog('PR body generated.');

  // Optional: AI-summarised file walkthrough + commits tables appended to the body
  body = await appendGeneratedTables(opts, cwd, headSha, body);

  // Generate PR review (optional) — also streamed
  let review: string | undefined;
  if (opts.generateReview) {
    opts.onLog('Generating PR review...');
    review = '';
    const reviewUsage = await chatCompleteStream(opts.llm, [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Perform a thorough code review of this pull request.

Include sections: Overall Assessment, Blocking Issues, Suggestions, Security Concerns, Test Coverage, Recommendation (Approve / Request Changes / Needs Discussion).

Branch: ${branch}

${opts.includeRecentCommits ? `Commits:\n${commits}\n` : ''}

Risk areas: ${opts.prRiskAreas.join(', ')}

${reviewRules ? 'Project standards:\n' + reviewRules : ''}

${diffLabel}:
${diffContext}

Test output:
${testOutput}`,
      },
    ], (delta) => {
      review! += delta;
      opts.onToken?.(delta);
    }, opts.signal);
    accumulateUsage(reviewUsage);
    opts.onLog('PR review generated.');
  }

  // Write output files
  const outputDir = path.join(opts.workspacePath, opts.outputDirectory);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'PR_TITLE.txt'), cleanTitle, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'PR_BODY.md'), body, 'utf-8');
  if (review) {
    fs.writeFileSync(path.join(outputDir, 'PR_REVIEW.md'), review, 'utf-8');
  }
  opts.onLog(`Output written to ${outputDir}`);

  return { title: cleanTitle, body, review, outputDir, branch, headSha, usage: totalUsage };
}

/**
 * Regenerate the PR body (or review) using a previous draft and a user instruction.
 * Reuses cached diffContext/testOutput — no re-diff, no re-test.
 */
export async function regeneratePr(
  opts: PrGeneratorOptions,
  previousDraft: string,
  instruction: string
): Promise<PrGeneratorResult> {
  if (!_diffCache) {
    throw new Error('No cached diff context. Run a full generation first.');
  }

  const cwd = opts.workspacePath;
  const branch = safeExec('git rev-parse --abbrev-ref HEAD', cwd).trim() || '(unknown branch)';
  const headSha = safeExec('git rev-parse HEAD', cwd).trim();
  const commits = opts.includeRecentCommits ? safeExec(`git log ${opts.baseBranch}..HEAD --oneline`, cwd) : '';
  const diffStat = safeExec(`git diff --stat ${opts.baseBranch}..HEAD`, cwd);
  const files    = safeExec(`git diff --name-status ${opts.baseBranch}..HEAD`, cwd);

  const { diffContext, testOutput } = _diffCache;

  const limits = getModelLimits(opts.llm.model);
  const ruleCapPerFile = Math.floor(Math.min(30_000, limits.inputBudgetChars / 8));
  const ruleParts: string[] = [];
  for (const rulesFile of opts.reviewRulesFiles) {
    try {
      const fullPath = path.join(opts.workspacePath, rulesFile);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (content.length > ruleCapPerFile) {
          content = content.slice(0, ruleCapPerFile) + `\n\n[...${rulesFile} truncated]`;
        }
        ruleParts.push(`--- ${rulesFile} ---\n${content}`);
      }
    } catch { /* skip */ }
  }
  const reviewRules = ruleParts.join('\n\n---\n\n');

  const budget = Math.max(limits.inputBudgetChars - 20_000, 30_000);
  const diffLabel = diffContext.length > budget * 0.8 ? 'Diff summaries' : 'Diff';

  const systemPrompt = `You are a senior software engineer writing a GitHub pull request for the ${opts.projectName} project.
Be specific, accurate, and concise. Use markdown formatting.`;

  const originalUserMessage = `Write a pull request description with these sections: ${opts.prBodySections.join(', ')}.

Branch: ${branch}
Base branch: ${opts.baseBranch}

${opts.includeRecentCommits ? `Commits:\n${commits}\n` : ''}

Changed files:
${diffStat}

${diffLabel}:
${diffContext}

Test output:
${testOutput}

${reviewRules ? 'Review rules:\n' + reviewRules : ''}

Risk areas to highlight: ${opts.prRiskAreas.join(', ')}

Write in markdown. Be specific about what changed and why.`;

  opts.onLog(`Regenerating with instruction: "${instruction}"`);

  let body = '';
  const regenUsage = await chatCompleteStream(opts.llm, [
    { role: 'system', content: systemPrompt },
    { role: 'user',      content: originalUserMessage },
    { role: 'assistant', content: stripGeneratedTables(previousDraft) },
    { role: 'user',      content: instruction },
  ], (delta) => {
    body += delta;
    opts.onToken?.(delta);
  }, opts.signal);

  // Re-append the generated tables (reuses the cached ones for this headSha)
  body = await appendGeneratedTables(opts, cwd, headSha, body);

  // Re-generate title from the new body
  const title = await chatComplete(opts.llm, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Generate a concise PR title (under 72 characters) for these changes:

Branch: ${branch}
${opts.includeRecentCommits ? `Commits:\n${commits}\n` : ''}

Changed files:
${files}

Respond with ONLY the title text. No quotes, no markdown, no explanation.`,
    },
  ], opts.signal);
  const cleanTitle = title.replace(/^["']|["']$/g, '').trim();
  opts.onLog(`Regenerated. Title: ${cleanTitle}`);

  const outputDir = path.join(opts.workspacePath, opts.outputDirectory);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'PR_TITLE.txt'), cleanTitle, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'PR_BODY.md'), body, 'utf-8');
  opts.onLog(`Output written to ${outputDir}`);

  return { title: cleanTitle, body, outputDir, branch, headSha, usage: regenUsage };
}
