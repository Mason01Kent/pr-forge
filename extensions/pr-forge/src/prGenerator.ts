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

function truncate(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) { return text; }
  return text.slice(0, maxChars) + `\n\n[...${label} truncated — ${text.length} chars total, showing first ${maxChars}...]`;
}

export async function generatePr(opts: PrGeneratorOptions): Promise<PrGeneratorResult> {
  const cwd = opts.workspacePath;
  const branch = safeExec('git rev-parse --abbrev-ref HEAD', cwd).trim() || '(unknown branch)';
  const commits = safeExec(`git log ${opts.baseBranch}..HEAD --oneline`, cwd);
  const diffStat = safeExec(`git diff --stat ${opts.baseBranch}..HEAD`, cwd);
  const files = safeExec(`git diff --name-status ${opts.baseBranch}..HEAD`, cwd);

  // Fetch diff per-file so large files can be dropped individually
  const changedFiles = files.split('\n').filter(Boolean).map(l => l.split('\t').pop() ?? '');
  let diff = '';
  const DIFF_BUDGET = 40_000;
  for (const file of changedFiles) {
    if (diff.length >= DIFF_BUDGET) {
      diff += `\n\n[...remaining files omitted — diff budget (${DIFF_BUDGET} chars) reached...]`;
      break;
    }
    const fileDiff = safeExec(`git diff ${opts.baseBranch}..HEAD -- "${file}"`, cwd);
    if (diff.length + fileDiff.length > DIFF_BUDGET) {
      diff += truncate(fileDiff, DIFF_BUDGET - diff.length, `diff for ${file}`);
      break;
    }
    diff += fileDiff;
  }

  opts.onLog(`Branch: ${branch}`);
  opts.onLog(`Commits: ${commits.split('\n').length} commits`);
  opts.onLog(`Files changed: ${changedFiles.length} (diff: ${diff.length} chars)`);

  // Load review rules — cap each file so one giant README can't blow the budget
  let reviewRules = '';
  const ruleParts: string[] = [];
  for (const rulesFile of opts.reviewRulesFiles) {
    try {
      const fullPath = path.join(opts.workspacePath, rulesFile);
      if (fs.existsSync(fullPath)) {
        const content = truncate(fs.readFileSync(fullPath, 'utf-8'), 8_000, rulesFile);
        ruleParts.push(`--- ${rulesFile} ---\n${content}`);
      }
    } catch {
      // skip files that can't be read
    }
  }
  if (ruleParts.length > 0) {
    reviewRules = ruleParts.join('\n\n---\n\n');
  }

  // Run tests — cap output so a verbose test suite doesn't consume the budget
  opts.onLog('Running tests...');
  const rawTestOutput = await runTestCommand(opts);
  const testOutput = truncate(rawTestOutput, 6_000, 'test output');
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

Diff:
${diff}

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

Diff:
${diff}

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
