import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { chatComplete, LLMClientOptions } from './llmClient';

export interface PrGeneratorOptions {
  workspacePath: string;
  baseBranch: string;
  outputDirectory: string;
  projectName: string;
  prRiskAreas: string[];
  prBodySections: string[];
  reviewRulesFiles: string[];
  testCommand: string;
  generateReview: boolean;
  llm: LLMClientOptions;
  onLog: (msg: string) => void;
}

export interface PrGeneratorResult {
  title: string;
  body: string;
  review?: string;
  outputDir: string;
  branch: string;
}

// Max chars per LLM call. ~30KB leaves plenty of room for the prompt
// wrapper and the 4096-token completion on any supported provider.
const CHUNK_SIZE = 30_000;

// Generated/noisy files processed last so source files always fit first.
const NOISY_PATTERNS = /\.(lock|min\.js|min\.css|map|snap|Designer\.cs|g\.cs)$|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Migrations\/.*\.cs$/i;

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 15000 }).toString();
  } catch {
    return '';
  }
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
 * Split an array of per-file diffs into batches that each fit within CHUNK_SIZE.
 * A single file larger than CHUNK_SIZE gets its own batch, truncated with a note.
 */
function batchFileDiffs(fileDiffs: { file: string; diff: string }[]): string[] {
  const batches: string[] = [];
  let current = '';
  for (const { file, diff } of fileDiffs) {
    const entry = diff.length > CHUNK_SIZE
      ? diff.slice(0, CHUNK_SIZE) + `\n\n[...diff for ${file} truncated at ${CHUNK_SIZE} chars]`
      : diff;
    if (current.length + entry.length > CHUNK_SIZE && current.length > 0) {
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
 * If the diff fits in one chunk, return it directly.
 * If not, summarise each batch with a quick LLM call, then return the combined summaries.
 */
async function buildDiffContext(
  fileDiffs: { file: string; diff: string }[],
  llm: LLMClientOptions,
  projectName: string,
  onLog: (msg: string) => void
): Promise<string> {
  const batches = batchFileDiffs(fileDiffs);
  if (batches.length === 1) {
    return batches[0];
  }

  onLog(`Diff too large for one pass — summarising ${batches.length} batches...`);
  const summaries: string[] = [];
  for (let i = 0; i < batches.length; i++) {
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
    ]);
    summaries.push(`### Batch ${i + 1} summary\n${summary}`);
  }
  return summaries.join('\n\n');
}

export async function generatePr(opts: PrGeneratorOptions): Promise<PrGeneratorResult> {
  const cwd = opts.workspacePath;
  const branch = safeExec('git rev-parse --abbrev-ref HEAD', cwd).trim() || '(unknown branch)';
  const commits = safeExec(`git log ${opts.baseBranch}..HEAD --oneline`, cwd);
  const diffStat = safeExec(`git diff --stat ${opts.baseBranch}..HEAD`, cwd);
  const files    = safeExec(`git diff --name-status ${opts.baseBranch}..HEAD`, cwd);

  // Collect per-file diffs — source files first, generated files last
  const allFiles = files.split('\n').filter(Boolean).map(l => l.split('\t').pop() ?? '');
  const ordered  = [
    ...allFiles.filter(f => !NOISY_PATTERNS.test(f)),
    ...allFiles.filter(f =>  NOISY_PATTERNS.test(f)),
  ];
  const fileDiffs = ordered.map(file => ({
    file,
    diff: safeExec(`git diff ${opts.baseBranch}..HEAD -- "${file}"`, cwd),
  }));

  opts.onLog(`Branch: ${branch}`);
  opts.onLog(`Commits: ${commits.split('\n').filter(Boolean).length}`);
  opts.onLog(`Files changed: ${allFiles.length}`);

  // Build diff context — single pass or multi-batch summarise
  const diffContext = await buildDiffContext(fileDiffs, opts.llm, opts.projectName, opts.onLog);

  // Load review rules — cap each file at CHUNK_SIZE/4 so one giant README
  // doesn't crowd out the diff in the final prompt
  const ruleParts: string[] = [];
  for (const rulesFile of opts.reviewRulesFiles) {
    try {
      const fullPath = path.join(opts.workspacePath, rulesFile);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        const cap = Math.floor(CHUNK_SIZE / 4);
        if (content.length > cap) {
          content = content.slice(0, cap) + `\n\n[...${rulesFile} truncated]`;
        }
        ruleParts.push(`--- ${rulesFile} ---\n${content}`);
      }
    } catch { /* skip */ }
  }
  const reviewRules = ruleParts.join('\n\n---\n\n');

  // Test output — keep the tail so failure messages are never cut off
  opts.onLog('Running tests...');
  const rawTestOutput = await runTestCommand(opts);
  const TEST_CAP = 6_000;
  const testOutput = rawTestOutput.length <= TEST_CAP
    ? rawTestOutput
    : `[...showing last ${TEST_CAP} chars — failures appear at end...]\n\n` + rawTestOutput.slice(-TEST_CAP);
  opts.onLog('Tests completed.');

  const systemPrompt = `You are a senior software engineer writing a GitHub pull request for the ${opts.projectName} project.
Be specific, accurate, and concise. Use markdown formatting.`;

  // Generate PR title
  opts.onLog('Generating PR title...');
  const title = await chatComplete(opts.llm, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Generate a concise PR title (under 72 characters) for these changes:

Branch: ${branch}
Commits:
${commits}

Changed files:
${files}

Respond with ONLY the title text. No quotes, no markdown, no explanation.`,
    },
  ]);
  const cleanTitle = title.replace(/^["']|["']$/g, '').trim();
  opts.onLog(`Title: ${cleanTitle}`);

  // Generate PR body
  opts.onLog('Generating PR body...');
  const body = await chatComplete(opts.llm, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Write a pull request description with these sections: ${opts.prBodySections.join(', ')}.

Branch: ${branch}
Base branch: ${opts.baseBranch}

Commits:
${commits}

Changed files:
${diffStat}

${diffContext.length > CHUNK_SIZE * 0.8 ? 'Diff summaries' : 'Diff'}:
${diffContext}

Test output:
${testOutput}

${reviewRules ? 'Review rules:\n' + reviewRules : ''}

Risk areas to highlight: ${opts.prRiskAreas.join(', ')}

Write in markdown. Be specific about what changed and why.`,
    },
  ]);
  opts.onLog('PR body generated.');

  // Generate PR review (optional)
  let review: string | undefined;
  if (opts.generateReview) {
    opts.onLog('Generating PR review...');
    review = await chatComplete(opts.llm, [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Perform a thorough code review of this pull request.

Include sections: Overall Assessment, Blocking Issues, Suggestions, Security Concerns, Test Coverage, Recommendation (Approve / Request Changes / Needs Discussion).

Branch: ${branch}

Commits:
${commits}

Risk areas: ${opts.prRiskAreas.join(', ')}

${reviewRules ? 'Project standards:\n' + reviewRules : ''}

${diffContext.length > CHUNK_SIZE * 0.8 ? 'Diff summaries' : 'Diff'}:
${diffContext}

Test output:
${testOutput}`,
      },
    ]);
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

  return { title: cleanTitle, body, review, outputDir, branch };
}
