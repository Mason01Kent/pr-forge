import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SidebarProvider } from './sidebarProvider';
import { PreviewPanel, PreviewContent } from './previewPanel';
import { renderMarkdown } from './markdownRenderer';
import { generatePr, regeneratePr, clearDiffCache, generateInlineFindings, getFileDiffs, generatePrBodyTemplate } from './prGenerator';
import { mapFindingsToComments, findingsToFallbackComment } from './reviewComments';
import { PrForgeConfig, migrateConfig } from './config';
import { PROVIDERS, DEFAULT_MODELS, UsageStats } from './llmClient';
import { getApiKey, hasApiKey, promptSetApiKey } from './secretsManager';
import { parseRemote, ReviewThread } from './scm/index';
import { initTelemetry, disposeTelemetry, telemetryEvent, telemetryError, classifyError } from './telemetry';
import { discoverRepositoryTemplateFiles } from './templateDiscovery';

const OUTPUT_CHANNEL_NAME = 'PR Forge';
const CONFIG_FILE_NAME = '.pr-forge.json';

let extensionUri: vscode.Uri;
let extensionContext: vscode.ExtensionContext;

let outputChannel: vscode.OutputChannel;
let statusBarTools: vscode.StatusBarItem;
let statusBarPrBody: vscode.StatusBarItem;
let statusBarPrReview: vscode.StatusBarItem;
let provider: SidebarProvider;
let lastPreviewMarkdown = '';
let reReviewTimer: ReturnType<typeof setInterval> | undefined;
let reReviewLastSha: string | undefined;
let reReviewPrompting = false;
let lastBodyContent: PreviewContent | undefined;
let lastReviewContent: PreviewContent | undefined;
let activeAbortController: AbortController | undefined;
let workspaceWatchers: vscode.Disposable[] = [];

interface GeneratedArtifacts {
    titleExists: boolean;
    bodyExists: boolean;
    reviewExists: boolean;
    generatedTitle: string;
    generatedTitleShort: string;
    lastGeneratedAt: string | null;
}

function normalizeGeneratedTitle(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    return trimmed || 'PR Content';
}

function shortenGeneratedTitle(title: string, maxLength = 32): string {
    const normalized = normalizeGeneratedTitle(title);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function readGeneratedArtifacts(workspaceFolder: vscode.WorkspaceFolder, config: PrForgeConfig): GeneratedArtifacts {
    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const titlePath = path.join(outputDir, 'PR_TITLE.txt');
    const bodyPath = path.join(outputDir, 'PR_BODY.md');
    const reviewPath = path.join(outputDir, 'PR_REVIEW.md');

    const titleExists = fs.existsSync(titlePath);
    const bodyExists = fs.existsSync(bodyPath);
    const reviewExists = fs.existsSync(reviewPath);

    let generatedTitle = 'PR Content';
    if (titleExists) {
        try {
            generatedTitle = normalizeGeneratedTitle(fs.readFileSync(titlePath, 'utf-8'));
        } catch {
            generatedTitle = 'PR Content';
        }
    }
    const generatedTitleShort = shortenGeneratedTitle(generatedTitle);

    const mtimes = [
        titleExists ? fs.statSync(titlePath).mtime : null,
        bodyExists ? fs.statSync(bodyPath).mtime : null,
        reviewExists ? fs.statSync(reviewPath).mtime : null,
    ].filter((value): value is Date => value !== null);
    const lastGeneratedAt = mtimes.length > 0
        ? mtimes.reduce((latest, current) => current > latest ? current : latest).toLocaleTimeString()
        : null;

    return { titleExists, bodyExists, reviewExists, generatedTitle, generatedTitleShort, lastGeneratedAt };
}

function readPreviewContentFromDisk(
    workspaceFolder: vscode.WorkspaceFolder,
    config: PrForgeConfig,
    kind: 'prBody' | 'prReview',
    artifacts?: GeneratedArtifacts
): PreviewContent | undefined {
    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const bodyPath = path.join(outputDir, kind === 'prBody' ? 'PR_BODY.md' : 'PR_REVIEW.md');
    if (!fs.existsSync(bodyPath)) {
        return undefined;
    }

    const body = fs.readFileSync(bodyPath, 'utf-8');
    if (kind === 'prBody') {
        const title = artifacts?.generatedTitle ?? (fs.existsSync(path.join(outputDir, 'PR_TITLE.txt'))
            ? normalizeGeneratedTitle(fs.readFileSync(path.join(outputDir, 'PR_TITLE.txt'), 'utf-8'))
            : 'PR Content');
        return {
            kind: 'prBody',
            title,
            body,
            timestamp: fs.statSync(bodyPath).mtime.toLocaleTimeString(),
            headBranch: getCurrentBranch(workspaceFolder.uri.fsPath) ?? undefined,
            baseBranch: config.baseBranch,
        };
    }

    return {
        kind: 'prReview',
        body,
        timestamp: fs.statSync(bodyPath).mtime.toLocaleTimeString(),
    };
}

function clearGenerationUiState(): void {
    provider.updateState({ generationStep: null, generationKind: null });
}

async function openRenderedPreview(kind: 'prBody' | 'prReview'): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('PR Forge: No workspace folder open.');
        return;
    }
    const config = await ensureConfig(workspaceFolder);
    if (!config) {
        return;
    }

    const content = kind === 'prBody'
        ? lastBodyContent ?? readPreviewContentFromDisk(workspaceFolder, config, 'prBody')
        : lastReviewContent ?? readPreviewContentFromDisk(workspaceFolder, config, 'prReview');

    if (!content) {
        vscode.window.showErrorMessage(`PR Forge: Generate a PR ${kind === 'prBody' ? 'Body' : 'Review'} first.`);
        return;
    }

    PreviewPanel.createOrShow(extensionUri, content, workspaceFolder.uri.fsPath, config.outputDirectory);
}

function cancelActiveGeneration(): void {
    activeAbortController?.abort();
}

function notifyGenerationStep(step: string): void {
    provider.notifyStep(step);
}

function logGenerationStep(msg: string): void {
    log(msg);

    const lower = msg.toLowerCase();
    if (lower.includes('diff') || lower.includes('commit')) {
        notifyGenerationStep('Reading diff and commits...');
    } else if (lower.includes('test')) {
        notifyGenerationStep('Running tests...');
    } else if (lower.includes('title')) {
        notifyGenerationStep('Generating PR title...');
    } else if (lower.includes('review')) {
        notifyGenerationStep('Generating PR review...');
    } else if (lower.includes('body') || lower.includes('draft')) {
        notifyGenerationStep('Generating PR body...');
    }
}

function log(msg: string): void {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function logUsage(usage: UsageStats): void {
    const cost = usage.estimatedCostUsd !== undefined
        ? ` | est. cost $${usage.estimatedCostUsd.toFixed(4)}`
        : '';
    log(`Tokens: ${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out${cost}`);
}

function updateArtifactState(workspaceFolder: vscode.WorkspaceFolder, config: PrForgeConfig): void {
    const artifacts = readGeneratedArtifacts(workspaceFolder, config);
    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const bodyContent = artifacts.bodyExists ? readPreviewContentFromDisk(workspaceFolder, config, 'prBody', artifacts) : undefined;
    const reviewContent = artifacts.reviewExists ? readPreviewContentFromDisk(workspaceFolder, config, 'prReview', artifacts) : undefined;

    lastBodyContent = bodyContent;
    lastReviewContent = reviewContent;
    lastPreviewMarkdown = bodyContent?.body ?? reviewContent?.body ?? '';

    provider.updateState({
        titleExists: artifacts.titleExists,
        bodyExists: artifacts.bodyExists,
        reviewExists: artifacts.reviewExists,
        generatedTitle: artifacts.generatedTitle,
        generatedTitleShort: artifacts.generatedTitleShort,
        lastGeneratedAt: artifacts.lastGeneratedAt,
        prBodyReady: artifacts.bodyExists,
        prReviewReady: artifacts.reviewExists,
        previewTitle: artifacts.bodyExists ? artifacts.generatedTitle : null,
        previewBody: bodyContent ? renderMarkdown(bodyContent.body) : reviewContent ? renderMarkdown(reviewContent.body) : null,
    });
    log(`Refreshed generated artifacts from ${outputDir}`);
}

async function refreshWorkspaceState(): Promise<void> {
    const wf = getWorkspaceFolderWithConfig();
    if (!wf) {
        return;
    }
    const cfg = readConfig(wf);
    if (!cfg) {
        provider.updateState({
            configExists: false,
            projectName: wf.name,
            currentBranch: getCurrentBranch(wf.uri.fsPath),
            baseBranch: null,
            titleExists: false,
            bodyExists: false,
            reviewExists: false,
            generatedTitle: 'PR Content',
            generatedTitleShort: 'PR Content',
            lastGeneratedAt: null,
            prBodyReady: false,
            prReviewReady: false,
            previewTitle: null,
            previewBody: null,
        });
        return;
    }
    const branch = getCurrentBranch(wf.uri.fsPath);
    const keySet = await hasApiKey(extensionContext, cfg.provider);
    provider.updateState({
        configExists: true,
        projectName: cfg.projectName,
        provider: cfg.provider,
        providerKeySet: keySet,
        currentBranch: branch,
        baseBranch: cfg.baseBranch,
        currentModel: cfg.defaultModel,
        runTestsOnGenerate: cfg.runTestsOnGenerate ?? true,
        includeRecentCommits: cfg.includeRecentCommits ?? false,
        includeCommitSummaries: cfg.includeCommitSummaries ?? false,
        includeFileWalkthrough: cfg.includeFileWalkthrough ?? false,
        reReviewOnPush: cfg.reReviewOnPush ?? false,
    });
    updateReReviewWatcher(cfg.reReviewOnPush ?? false);
    const hasArtifacts = fs.existsSync(path.join(wf.uri.fsPath, cfg.outputDirectory, 'PR_BODY.md')) || fs.existsSync(path.join(wf.uri.fsPath, cfg.outputDirectory, 'PR_REVIEW.md'));
    if (hasArtifacts) {
        updateArtifactState(wf, cfg);
    } else {
        provider.updateState({
            titleExists: false,
            bodyExists: false,
            reviewExists: false,
            generatedTitle: 'PR Content',
            generatedTitleShort: 'PR Content',
            lastGeneratedAt: null,
            prBodyReady: false,
            prReviewReady: false,
            previewTitle: null,
            previewBody: null,
        });
    }
    if (provider.getState().submittedPrNumber) {
        void refreshReadiness(true);
    }
}

async function withStatusBarSpinner(
    bar: vscode.StatusBarItem,
    originalText: string,
    operation: () => Promise<boolean>
): Promise<boolean> {
    bar.text = '$(loading~spin) Running...';
    bar.backgroundColor = undefined;
    const success = await operation();
    bar.text = success ? '$(check) Done' : '$(error) Failed';
    bar.backgroundColor = new vscode.ThemeColor(success ? 'statusBarItem.prominentBackground' : 'statusBarItem.warningBackground');
    setTimeout(() => { bar.text = originalText; bar.backgroundColor = undefined; }, 3000);
    return success;
}

async function resolveTargetProjectFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    if (folders.length === 1) return folders[0];
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const matchingFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (matchingFolder) return matchingFolder;
    }
    const picks = folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f }));
    const chosen = await vscode.window.showQuickPick(picks, { placeHolder: 'Select the target project folder' });
    return chosen?.folder;
}

function getConfigPath(workspaceFolder: vscode.WorkspaceFolder): string {
    return path.join(workspaceFolder.uri.fsPath, CONFIG_FILE_NAME);
}

/** Find a workspace folder with a config file without showing a picker dialog. */
function getWorkspaceFolderWithConfig(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    if (folders.length === 1) return folders[0];
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const match = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (match && fs.existsSync(getConfigPath(match))) return match;
    }
    return folders.find(f => fs.existsSync(getConfigPath(f))) ?? folders[0];
}

function readConfig(workspaceFolder: vscode.WorkspaceFolder): PrForgeConfig | null {
    const configPath = getConfigPath(workspaceFolder);
    if (!fs.existsSync(configPath)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        return migrateConfig(raw);
    } catch (e) {
        log(`Error reading config: ${e}`);
        return null;
    }
}

function writeConfig(workspaceFolder: vscode.WorkspaceFolder, config: PrForgeConfig): void {
    fs.writeFileSync(getConfigPath(workspaceFolder), JSON.stringify(config, null, 2), 'utf-8');
}

async function ensureConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<PrForgeConfig | null> {
    const config = readConfig(workspaceFolder);
    if (config) return config;
    const choice = await vscode.window.showWarningMessage(`No ${CONFIG_FILE_NAME} found. Initialize project config now?`, 'Yes', 'No');
    if (choice !== 'Yes') return null;
    await initializeProjectConfig(workspaceFolder);
    return readConfig(workspaceFolder);
}

/**
 * Check the output directory for previously generated PR files and restore
 * sidebar state so "last run" info and preview content survive extension restarts.
 */
async function clearPrOutput(): Promise<void> {
    const wf = getWorkspaceFolderWithConfig();
    if (!wf) return;
    const cfg = readConfig(wf);
    if (cfg) {
        const outputDir = path.join(wf.uri.fsPath, cfg.outputDirectory);
        for (const f of ['PR_TITLE.txt', 'PR_BODY.md', 'PR_REVIEW.md']) {
            const p = path.join(outputDir, f);
            if (fs.existsSync(p)) { fs.unlinkSync(p); }
        }
    }
    lastPreviewMarkdown = '';
    lastBodyContent = undefined;
    lastReviewContent = undefined;
    clearDiffCache();
    provider.updateState({
        prBodyReady: false,
        prReviewReady: false,
        lastRunType: null,
        lastRunStatus: null,
        lastRunTimestamp: null,
        generationStep: null,
        generationKind: null,
        previewTitle: null,
        previewBody: null,
        submittedPrNumber: null,
        submittedPrUrl: null,
        submittedPrTimestamp: null,
        readinessState: null,
        readinessSummary: null,
        readinessBlockers: [],
        readinessInfo: [],
        readinessUpdatedAt: null,
        viewMode: 'tools',
        titleExists: false,
        bodyExists: false,
        reviewExists: false,
        generatedTitle: 'PR Content',
        generatedTitleShort: 'PR Content',
        lastGeneratedAt: null,
    });
    log('PR draft cleared.');
}

async function initializeProjectConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const configPath = getConfigPath(workspaceFolder);
    if (fs.existsSync(configPath)) {
        const overwrite = await vscode.window.showWarningMessage(`${CONFIG_FILE_NAME} already exists. Overwrite?`, 'Yes', 'No');
        if (overwrite !== 'Yes') return;
    }
    const rootPath = workspaceFolder.uri.fsPath;
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    let projectName = workspaceFolder.name;
    const slnFiles = entries.filter(e => e.isFile() && e.name.endsWith('.sln'));
    if (slnFiles.length === 1) projectName = slnFiles[0].name.replace(/\.sln$/i, '');
    let projectType = 'unknown';
    const hasSln = entries.some(e => e.isFile() && e.name.endsWith('.sln'));
    const hasCsproj = entries.some(e => e.isFile() && e.name.endsWith('.csproj'));
    const hasPackageJson = entries.some(e => e.isFile() && e.name === 'package.json');
    const hasPyproject = entries.some(e => e.isFile() && e.name === 'pyproject.toml');
    const hasRequirements = entries.some(e => e.isFile() && e.name === 'requirements.txt');
    if (!hasCsproj) {
        try {
            for (const dir of entries.filter(e => e.isDirectory())) {
                const subEntries = fs.readdirSync(path.join(rootPath, dir.name), { withFileTypes: true });
                if (subEntries.some(se => se.isFile() && se.name.endsWith('.csproj'))) { projectType = 'dotnet'; break; }
            }
        } catch { /* ignore */ }
    }
    if (hasSln || hasCsproj) {
        projectType = 'dotnet';
    } else if (hasPackageJson) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            projectType = deps['react'] ? 'react' : 'node';
        } catch { projectType = 'node'; }
    } else if (hasPyproject || hasRequirements) {
        projectType = 'python';
    }
    const testCommands: Record<string, string> = { dotnet: 'dotnet test --configuration Release', node: 'npm test', react: 'npm test', python: 'pytest', unknown: '' };
    const reviewRulesFiles: string[] = [];
    for (const file of ['AGENTS.md', 'README.md', 'docs/agent-guides/current-state.md', 'docs/KNOWN_ISSUES.md']) {
        if (fs.existsSync(path.join(rootPath, file))) reviewRulesFiles.push(file);
    }
    const templateFiles = discoverRepositoryTemplateFiles(rootPath);
    const isSellWise = projectName.toLowerCase().includes('sellwise') || workspaceFolder.name.toLowerCase().includes('sellwise');
    const prRiskAreas = isSellWise
        ? ['authentication', 'authorization', 'ownership isolation', 'PostgreSQL migrations', 'decimal money handling', 'inventory transactions', 'refunds', 'production readiness', 'config/secrets safety']
        : ['security', 'tests', 'configuration', 'data integrity', 'deployment risk'];
    const config: PrForgeConfig = {
        schemaVersion: 8, projectName, baseBranch: 'main', projectType,
        testCommand: testCommands[projectType] || '', runTestsOnGenerate: true, includeRecentCommits: false,
        includeCommitSummaries: false, includeFileWalkthrough: false, reReviewOnPush: false,
        outputDirectory: '.pr',
        provider: 'deepseek', defaultModel: 'deepseek-chat',
        reviewRulesFiles, templateFiles,
        prLabels: [], prReviewers: [], prAssignees: [], prMilestone: '',
        prRiskAreas,
        prBodySections: ['Summary', 'Why this matters', 'Changes', 'Tests / verification', 'Review focus', 'Risks / follow-ups']
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    log(`Config initialized: ${configPath}`);
    vscode.window.showInformationMessage(`PR Forge: Config initialized at ${CONFIG_FILE_NAME}`);
}

async function openProjectConfig(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const configPath = getConfigPath(workspaceFolder);
    if (!fs.existsSync(configPath)) {
        const choice = await vscode.window.showWarningMessage(`No ${CONFIG_FILE_NAME} found. Create one now?`, 'Yes', 'No');
        if (choice === 'Yes') await initializeProjectConfig(workspaceFolder);
        else return;
    }
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
}

async function generatePrBody(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    const currentBranch = getCurrentBranch(workspaceFolder.uri.fsPath);
    if (currentBranch === config.baseBranch) {
        vscode.window.showErrorMessage(`PR Forge: You are on ${config.baseBranch}. Switch to a feature branch before generating.`);
        return;
    }

    const apiKey = (await getApiKey(extensionContext, config.provider)) ?? '';
    const providerInfo = PROVIDERS[config.provider];
    const noAiKey = !providerInfo?.noAuth && !apiKey;
    if (noAiKey) {
        vscode.window.showInformationMessage(
            'PR Forge: No AI key configured — generating a template PR body from git data. Add a key via Set API Key for AI-written descriptions.',
            'Set API Key'
        ).then(action => { if (action === 'Set API Key') promptSetApiKey(extensionContext, config.provider); });
    }

    outputChannel.show(true);
    provider.notifyRunStart('prBody');
    vscode.commands.executeCommand('workbench.view.extension.prForge');

    const abortController = new AbortController();
    activeAbortController = abortController;
    const t0 = Date.now();
    notifyGenerationStep('Reading diff and commits...');

    const success = await withStatusBarSpinner(statusBarPrBody, '$(git-pull-request) PR Body', async () => {
        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Generating PR Body...', cancellable: true },
                async (_progress, token) => {
                    token.onCancellationRequested(() => abortController.abort());
                    const genOpts = {
                        workspacePath: workspaceFolder.uri.fsPath,
                        baseBranch: config.baseBranch,
                        includeRecentCommits: config.includeRecentCommits ?? false,
                        includeCommitSummaries: config.includeCommitSummaries ?? false,
                        includeFileWalkthrough: config.includeFileWalkthrough ?? false,
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        templateFiles: config.templateFiles ?? [],
                        testCommand: config.testCommand,
                        runTests: config.runTestsOnGenerate ?? true,
                        generateReview: false,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg: string) => logGenerationStep(msg),
                        signal: abortController.signal,
                    };
                    return noAiKey ? generatePrBodyTemplate(genOpts) : generatePr(genOpts);
                }
            );
            if (!noAiKey) { logUsage(result.usage); }
            telemetryEvent('generate.prBody', { provider: noAiKey ? 'none' : config.provider, model: noAiKey ? 'template' : config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            const previewContent: PreviewContent = { kind: 'prBody', title: result.title, body: result.body, timestamp: new Date().toLocaleString(), headBranch: result.branch, baseBranch: config.baseBranch };
            lastBodyContent = previewContent;
            PreviewPanel.createOrShow(extensionUri, previewContent, workspaceFolder.uri.fsPath, config.outputDirectory);
            lastPreviewMarkdown = result.body;
            updateArtifactState(workspaceFolder, config);
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('generate.prBody', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Generation cancelled.');
                return false;
            }
            telemetryError('generate.prBody', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    activeAbortController = undefined;
    provider.notifyRunEnd('prBody', success);
    if (!success) {
        clearGenerationUiState();
    }
    provider.updateState({ configExists: true, projectName: config.projectName, provider: config.provider, currentBranch: getCurrentBranch(workspaceFolder.uri.fsPath), baseBranch: config.baseBranch });
    hasApiKey(extensionContext, config.provider).then(keySet => provider.updateState({ providerKeySet: keySet }));
}

async function generatePrReview(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    const currentBranch = getCurrentBranch(workspaceFolder.uri.fsPath);
    if (currentBranch === config.baseBranch) {
        vscode.window.showErrorMessage(`PR Forge: You are on ${config.baseBranch}. Switch to a feature branch before generating.`);
        return;
    }

    const apiKey = (await getApiKey(extensionContext, config.provider)) ?? '';
    const providerInfo = PROVIDERS[config.provider];
    if (!providerInfo?.noAuth && !apiKey) {
        const action = await vscode.window.showInformationMessage(
            'PR Forge: PR Review requires an AI provider key. Set one up to use this feature.',
            'Set API Key'
        );
        if (action === 'Set API Key') await promptSetApiKey(extensionContext, config.provider);
        return;
    }

    outputChannel.show(true);
    provider.notifyRunStart('prReview');
    vscode.commands.executeCommand('workbench.view.extension.prForge');

    const abortController = new AbortController();
    activeAbortController = abortController;
    const t0 = Date.now();
    notifyGenerationStep('Reading diff and commits...');

    const success = await withStatusBarSpinner(statusBarPrReview, '$(comment-discussion) PR Review', async () => {
        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Generating PR Review...', cancellable: true },
                async (_progress, token) => {
                    token.onCancellationRequested(() => abortController.abort());
                    return generatePr({
                        workspacePath: workspaceFolder.uri.fsPath,
                        baseBranch: config.baseBranch,
                        includeRecentCommits: config.includeRecentCommits ?? false,
                        includeCommitSummaries: config.includeCommitSummaries ?? false,
                        includeFileWalkthrough: config.includeFileWalkthrough ?? false,
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        templateFiles: config.templateFiles ?? [],
                        testCommand: config.testCommand,
                        runTests: config.runTestsOnGenerate ?? true,
                        generateReview: true,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg) => logGenerationStep(msg),
                        signal: abortController.signal,
                    });
                }
            );
            logUsage(result.usage);
            telemetryEvent('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            if (result.review) {
                const reviewContent: PreviewContent = { kind: 'prReview', body: result.review, timestamp: new Date().toLocaleString() };
                lastReviewContent = reviewContent;
                PreviewPanel.createOrShow(extensionUri, reviewContent, workspaceFolder.uri.fsPath, config.outputDirectory);
                lastPreviewMarkdown = result.review;
                updateArtifactState(workspaceFolder, config);
            }
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Generation cancelled.');
                return false;
            }
            telemetryError('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    activeAbortController = undefined;
    provider.notifyRunEnd('prReview', success);
    if (!success) {
        clearGenerationUiState();
    }
    provider.updateState({ configExists: true, projectName: config.projectName, provider: config.provider, currentBranch: getCurrentBranch(workspaceFolder.uri.fsPath), baseBranch: config.baseBranch });
    hasApiKey(extensionContext, config.provider).then(keySet => provider.updateState({ providerKeySet: keySet }));
}

async function regeneratePrBodyWithInstruction(instruction: string): Promise<void> {
    const workspaceFolder = getWorkspaceFolderWithConfig();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = readConfig(workspaceFolder);
    if (!config) { vscode.window.showErrorMessage('PR Forge: No config found.'); return; }

    const apiKey = (await getApiKey(extensionContext, config.provider)) ?? '';
    const providerInfo = PROVIDERS[config.provider];
    if (!providerInfo?.noAuth && !apiKey) { return; }

    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const bodyPath  = path.join(outputDir, 'PR_BODY.md');
    const previousDraft = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf-8') : '';

    outputChannel.show(true);
    provider.notifyRunStart('prBody');
    notifyGenerationStep('Generating PR body...');

    const abortController = new AbortController();
    activeAbortController = abortController;
    const t0 = Date.now();

    const success = await withStatusBarSpinner(statusBarPrBody, '$(git-pull-request) PR Body', async () => {
        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Regenerating PR Body...', cancellable: true },
                async (_progress, token) => {
                    token.onCancellationRequested(() => abortController.abort());
                    return regeneratePr({
                        workspacePath: workspaceFolder.uri.fsPath,
                        baseBranch: config.baseBranch,
                        includeRecentCommits: config.includeRecentCommits ?? false,
                        includeCommitSummaries: config.includeCommitSummaries ?? false,
                        includeFileWalkthrough: config.includeFileWalkthrough ?? false,
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        templateFiles: config.templateFiles ?? [],
                        testCommand: config.testCommand,
                        runTests: false,
                        generateReview: false,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg) => logGenerationStep(msg),
                        signal: abortController.signal,
                    }, previousDraft, instruction);
                }
            );
            logUsage(result.usage);
            telemetryEvent('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            lastPreviewMarkdown = result.body;
            updateArtifactState(workspaceFolder, config);
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Regeneration cancelled.');
                return false;
            }
            telemetryError('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    activeAbortController = undefined;
    provider.notifyRunEnd('prBody', success);
}

async function setApiKey(): Promise<void> {
    const wf = await resolveTargetProjectFolder();
    const config = wf ? readConfig(wf) : null;
    const result = await promptSetApiKey(extensionContext, config?.provider);
    if (result && wf && config) {
        // Persist the chosen provider (and its default model) so generation
        // actually uses the provider the user just configured a key for.
        if (config.provider !== result) {
            config.provider = result;
            config.defaultModel = DEFAULT_MODELS[result] || config.defaultModel;
            writeConfig(wf, config);
            log(`Provider switched to ${result} (model: ${config.defaultModel}).`);
        }
        const keySet = await hasApiKey(extensionContext, result);
        provider.updateState({ provider: result, providerKeySet: keySet });
        telemetryEvent('setApiKey', { provider: result });
        void refreshWorkspaceState();
    }
}

async function submitDraftPr(): Promise<void> {
    await submitPrInternal(true);
}

async function openInbox(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    if (!(await ensureConfig(workspaceFolder))) return;

    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?');
        return;
    }

    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" → "GitLab (SCM token)" to store your personal access token (api scope required).');
            return;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            return;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) {
        vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`);
        return;
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Loading inbox...', cancellable: false },
        async () => {
            const items = await remote.provider.listOpenPrs({ owner: remote.owner, repo: remote.repo });
            if (items.length === 0) {
                vscode.window.showInformationMessage('PR Forge: No open PRs or merge requests found.');
                return;
            }

            const pick = await vscode.window.showQuickPick(items.map(item => ({
                label: `#${item.number} ${item.title}`,
                description: item.draft ? 'Draft' : item.state ?? 'open',
                detail: [item.author ? `by ${item.author}` : '', item.updatedAt ? `updated ${item.updatedAt}` : '', item.labels?.length ? item.labels.join(', ') : ''].filter(Boolean).join(' · '),
                number: item.number,
                title: item.title,
                url: item.url,
            })), {
                title: `PR Forge Inbox - ${remote.owner}/${remote.repo}`,
                placeHolder: 'Select a pull request or merge request to open',
            });
            if (pick) {
                const action = await vscode.window.showQuickPick([
                    { label: 'Open in Browser', description: pick.url, actionType: 'browser' as const },
                    { label: 'Browse Review Threads', description: `PR #${pick.number}`, actionType: 'threads' as const },
                ], {
                    title: `PR #${pick.number} ${pick.title}`,
                    placeHolder: 'Choose what to do with this pull request or merge request',
                });
                if (!action) {
                    return;
                }
                if (action.actionType === 'threads') {
                    await browseReviewThreads(workspaceFolder, remote, pick.number, `PR Forge Review Threads - ${remote.owner}/${remote.repo}#${pick.number}`);
                    return;
                }
                await vscode.env.openExternal(vscode.Uri.parse(pick.url));
            }
        }
    );
}

async function resolveRemoteContext(workspaceFolder: vscode.WorkspaceFolder, silent = false): Promise<NonNullable<ReturnType<typeof parseRemote>> | null> {
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        if (!silent) { vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?'); }
        return null;
    }

    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            if (!silent) {
                vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" -> "GitLab (SCM token)" to store your personal access token (api scope required).');
            }
            return null;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            if (!silent) {
                vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            }
            return null;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) {
        if (!silent) {
            vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`);
        }
        return null;
    }
    return remote;
}

async function browseReviewThreads(
    workspaceFolder: vscode.WorkspaceFolder,
    remote: NonNullable<ReturnType<typeof parseRemote>>,
    prNumber: number,
    titleHint?: string,
): Promise<void> {
    type ThreadPickItem = vscode.QuickPickItem & { thread: ReviewThread };
    type ThreadActionKind = 'openFile' | 'openDiscussion' | 'browseComments';
    type ThreadActionItem = vscode.QuickPickItem & { actionType: ThreadActionKind };
    type ThreadCommentPickItem = vscode.QuickPickItem & { comment: ReviewThread['comments'][number] };

    const threads = await remote.provider.listReviewThreads({ owner: remote.owner, repo: remote.repo, number: prNumber });
    if (threads.length === 0) {
        vscode.window.showInformationMessage('PR Forge: No review threads or discussions found.');
        return;
    }

    const pick = await vscode.window.showQuickPick<ThreadPickItem>(threads.map(thread => ({
        label: thread.title,
        description: [thread.state, thread.actionable ? 'actionable' : 'read-only'].filter(Boolean).join(' · '),
        detail: [
            thread.comments.length ? `${thread.comments.length} comment(s)` : '',
            thread.comments[0]?.body ? thread.comments[0].body : '',
        ].filter(Boolean).join(' · '),
        thread,
    })), {
        title: titleHint ?? `PR Forge Review Threads - ${remote.owner}/${remote.repo}#${prNumber}`,
        placeHolder: 'Select a review thread to inspect',
    });
    if (!pick) {
        return;
    }

    const thread = pick.thread as ReviewThread;
    const actions: ThreadActionItem[] = [];
    if (thread.path && typeof thread.line === 'number') {
        actions.push({ label: 'Open File', description: `${thread.path}:${thread.line}`, actionType: 'openFile' });
    }
    if (thread.comments.length > 0) {
        actions.push({ label: 'Browse Comments', description: `${thread.comments.length} comment(s)`, actionType: 'browseComments' });
    }
    actions.push({ label: 'Open Remote Discussion', description: thread.url, actionType: 'openDiscussion' });

    const action = await vscode.window.showQuickPick<ThreadActionItem>(actions, {
        title: thread.title,
        placeHolder: 'Choose how to open this thread',
    });
    if (!action) {
        return;
    }

    if (action.actionType === 'openFile' && thread.path && typeof thread.line === 'number') {
        const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, thread.path));
        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(doc, {
                preview: false,
                selection: new vscode.Range(Math.max(0, thread.line - 1), 0, Math.max(0, thread.line - 1), 0),
            });
            editor.revealRange(
                new vscode.Range(Math.max(0, thread.line - 1), 0, Math.max(0, thread.line - 1), 0),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
            return;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`PR Forge: Could not open ${thread.path}:${thread.line} — ${msg}`);
            return;
        }
    }

    if (action.actionType === 'browseComments') {
        const commentPick = await vscode.window.showQuickPick<ThreadCommentPickItem>(thread.comments.map((comment, index) => ({
            label: comment.author ? `${comment.author}` : `Comment ${index + 1}`,
            description: comment.createdAt ?? '',
            detail: comment.body,
            comment,
        })), {
            title: thread.title,
            placeHolder: 'Select a comment to open',
        });
        if (!commentPick) {
            return;
        }
        if (commentPick.comment.url) {
            await vscode.env.openExternal(vscode.Uri.parse(commentPick.comment.url));
            return;
        }
        if (thread.path && typeof thread.line === 'number') {
            const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, thread.path));
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                selection: new vscode.Range(Math.max(0, thread.line - 1), 0, Math.max(0, thread.line - 1), 0),
            });
            return;
        }
    }

    await vscode.env.openExternal(vscode.Uri.parse(thread.url));
}

async function refreshReadiness(silent = false): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) {
        if (!silent) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); }
        return;
    }
    if (!(await ensureConfig(workspaceFolder))) return;

    const prNumber = provider.getState().submittedPrNumber;
    if (!prNumber) {
        if (!silent) {
            vscode.window.showInformationMessage('PR Forge: Submit a PR or merge request first, then refresh readiness.');
        }
        provider.updateState({
            readinessState: null,
            readinessSummary: null,
            readinessBlockers: [],
            readinessInfo: [],
            readinessUpdatedAt: null,
        });
        return;
    }

    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        if (!silent) { vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?'); }
        return;
    }

    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            if (!silent) {
                vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" → "GitLab (SCM token)" to store your personal access token (api scope required).');
            }
            return;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            if (!silent) {
                vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            }
            return;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) {
        if (!silent) {
            vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`);
        }
        return;
    }

    try {
        const readiness = await remote.provider.getReadiness({ owner: remote.owner, repo: remote.repo, number: prNumber });
        provider.updateState({
            readinessState: readiness.state,
            readinessSummary: readiness.summary,
            readinessBlockers: readiness.blockers,
            readinessInfo: readiness.info,
            readinessUpdatedAt: readiness.updatedAt ?? new Date().toLocaleString(),
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        provider.updateState({
            readinessState: 'unknown',
            readinessSummary: msg,
            readinessBlockers: [],
            readinessInfo: [],
            readinessUpdatedAt: new Date().toLocaleString(),
        });
        if (!silent) {
            vscode.window.showErrorMessage(`PR Forge: Could not refresh readiness â€” ${msg}`);
        }
    }
}

async function openReviewThreads(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    if (!(await ensureConfig(workspaceFolder))) return;

    const remote = await resolveRemoteContext(workspaceFolder);
    if (!remote) { return; }

    const prNumber = provider.getState().submittedPrNumber;
    if (!prNumber) {
        vscode.window.showInformationMessage('PR Forge: Submit a PR or merge request first, then browse review threads.');
        return;
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Loading review threads...', cancellable: false },
        async () => {
            await browseReviewThreads(workspaceFolder, remote, prNumber, `PR Forge Review Threads - ${remote.owner}/${remote.repo}#${prNumber}`);
        }
    );
    return;
}

async function submitPr(): Promise<void> {
    await submitPrInternal(false);
}

async function submitPrInternal(draft: boolean): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const titlePath = path.join(outputDir, 'PR_TITLE.txt');
    const bodyPath  = path.join(outputDir, 'PR_BODY.md');

    if (!fs.existsSync(titlePath) || !fs.existsSync(bodyPath)) {
        vscode.window.showErrorMessage('PR Forge: Generate a PR Body first before submitting.');
        return;
    }

    // Get remote URL first so we can choose the right auth method
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?');
        return;
    }

    // Pick auth strategy based on remote host
    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" → "GitLab (SCM token)" to store your personal access token (api scope required).');
            return;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            return;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) {
        vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`);
        return;
    }

    // Get current branch
    let headBranch: string;
    try {
        headBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not determine current branch.');
        return;
    }

    if (headBranch === 'HEAD') {
        vscode.window.showErrorMessage('PR Forge: You are in detached HEAD state. Check out a branch first.');
        return;
    }
    if (headBranch === config.baseBranch) {
        vscode.window.showErrorMessage(`PR Forge: You are on the base branch (${config.baseBranch}). Switch to a feature branch first.`);
        return;
    }

    // Check that the branch has been pushed to origin
    let branchPushed = false;
    try {
        const tracking = execSync(`git rev-parse --abbrev-ref "${headBranch}@{u}"`, { cwd: workspaceFolder.uri.fsPath }).toString().trim();
        branchPushed = tracking.length > 0;
    } catch { /* no upstream set */ }

    if (!branchPushed) {
        const pushNow = await vscode.window.showWarningMessage(
            `Branch "${headBranch}" has not been pushed to origin. Push it now?`,
            'Push', 'Cancel'
        );
        if (pushNow !== 'Push') return;
        try {
            execSync(`git push -u origin "${headBranch}"`, { cwd: workspaceFolder.uri.fsPath });
            log(`Pushed branch ${headBranch} to origin.`);
        } catch (pushErr: unknown) {
            const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
            vscode.window.showErrorMessage(`PR Forge: Failed to push branch — ${msg}`);
            return;
        }
    }

    const title = fs.readFileSync(titlePath, 'utf-8').trim();
    const body  = fs.readFileSync(bodyPath,  'utf-8');

    const { owner, repo, provider: scm } = remote;

    // Check for an existing open PR on this branch
    let existingPr: { url: string; number: number } | null = null;
    try {
        existingPr = await scm.findOpenPr({ owner, repo, head: headBranch, token: token! });
    } catch { /* if lookup fails, fall through to create */ }

    let prUrl: string | undefined;
    let prNumber: number | undefined;

    if (existingPr) {
        const updateLabel = `Update PR #${existingPr.number}`;
        const confirm = await vscode.window.showInformationMessage(
            `PR #${existingPr.number} already exists for "${headBranch}". Update its title and description?`,
            { modal: true },
            updateLabel, 'Cancel'
        );
        if (confirm !== updateLabel) { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `PR Forge: Updating PR #${existingPr.number}...`, cancellable: false },
            async () => {
                try {
                    const result = await scm.updatePr({
                        owner,
                        repo,
                        number: existingPr!.number,
                        title,
                        body,
                        head: headBranch,
                        base: config.baseBranch,
                        token: token!,
                        labels: config.prLabels ?? [],
                        reviewers: config.prReviewers ?? [],
                        assignees: config.prAssignees ?? [],
                        milestone: config.prMilestone ?? '',
                    });
                    prUrl = result.url;
                    prNumber = result.number;
                    log(`PR #${prNumber} updated: ${prUrl}`);
                    telemetryEvent('submit.pr', { draft: String(draft), mode: 'update', outcome: 'success' });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    log(`PR update failed: ${msg}`);
                    telemetryError('submit.pr', { draft: String(draft), mode: 'update', outcome: 'error', errorKind: classifyError(err) });
                    vscode.window.showErrorMessage(`PR Forge: PR update failed — ${msg}`);
                }
            }
        );
    } else {
        const submitLabel = draft ? 'Submit Draft' : 'Submit';
        const draftLabel = draft ? ' (Draft)' : '';
        const confirm = await vscode.window.showInformationMessage(
            `Submit${draftLabel} PR: "${title}"\n${owner}/${repo}  •  ${headBranch} → ${config.baseBranch}`,
            { modal: true },
            submitLabel
        );
        if (confirm !== submitLabel) { return; }

        const progressTitle = draft ? 'PR Forge: Submitting draft PR...' : 'PR Forge: Submitting PR...';
        const prType = draft ? 'Draft PR' : 'PR';

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
            async () => {
                try {
                    const result = await scm.createPr({
                        owner,
                        repo,
                        title,
                        body,
                        head: headBranch,
                        base: config.baseBranch,
                        token: token!,
                        draft,
                        labels: config.prLabels ?? [],
                        reviewers: config.prReviewers ?? [],
                        assignees: config.prAssignees ?? [],
                        milestone: config.prMilestone ?? '',
                    });
                    prUrl = result.url;
                    prNumber = result.number;
                    log(`${prType} created: ${result.url}`);
                    telemetryEvent('submit.pr', { draft: String(draft), mode: 'create', outcome: 'success' });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    log(`PR submit failed: ${msg}`);
                    telemetryError('submit.pr', { draft: String(draft), mode: 'create', outcome: 'error', errorKind: classifyError(err) });
                    vscode.window.showErrorMessage(`PR Forge: PR submit failed — ${msg}`);
                }
            }
        );
    }

    // Show success after the spinner has closed
    if (prUrl && prNumber) {
        provider.updateState({
            submittedPrNumber: prNumber,
            submittedPrUrl: prUrl,
            submittedPrDraft: draft,
            submittedPrTimestamp: new Date().toLocaleTimeString(),
        });
        void refreshReadiness(true);
        const actionLabel = existingPr ? `PR #${prNumber} updated!` : `${draft ? 'Draft PR' : 'PR'} #${prNumber} created!`;
        const open = await vscode.window.showInformationMessage(actionLabel, 'Open in Browser');
        if (open === 'Open in Browser') { vscode.env.openExternal(vscode.Uri.parse(prUrl)); }
    }
}

async function postReviewToPr(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = readConfig(workspaceFolder);
    if (!config) { vscode.window.showErrorMessage('PR Forge: No config found.'); return; }

    const prNumber = provider.getState().submittedPrNumber;
    if (!prNumber) {
        vscode.window.showErrorMessage('PR Forge: Submit the PR first, then post the review to it.');
        return;
    }

    const reviewPath = path.join(workspaceFolder.uri.fsPath, config.outputDirectory, 'PR_REVIEW.md');
    if (!fs.existsSync(reviewPath)) {
        vscode.window.showErrorMessage('PR Forge: Generate a PR Review first before posting it.');
        return;
    }
    const review = fs.readFileSync(reviewPath, 'utf-8').trim();
    if (!review) {
        vscode.window.showErrorMessage('PR Forge: The generated review is empty.');
        return;
    }

    // Get remote URL first so we can choose the right auth method
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?');
        return;
    }

    // Pick auth strategy based on remote host
    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" → "GitLab (SCM token)" to store your personal access token (api scope required).');
            return;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            return;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) {
        vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`);
        return;
    }

    const confirm = await vscode.window.showInformationMessage(
        `Post the generated review as a comment on PR #${prNumber}?`,
        { modal: true },
        'Post Review'
    );
    if (confirm !== 'Post Review') { return; }

    const commentBody = `${review}\n\n---\n_Posted by [PR Forge](https://github.com/Mason01Kent/pr-forge)._`;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `PR Forge: Posting review to PR #${prNumber}...`, cancellable: false },
        async () => {
            try {
                const { url } = await remote.provider.postPrComment({ owner: remote.owner, repo: remote.repo, number: prNumber, body: commentBody });
                log(`Review posted to PR #${prNumber}: ${url}`);
                telemetryEvent('postReview', { outcome: 'success' });
                const open = await vscode.window.showInformationMessage(`Review posted to PR #${prNumber}.`, 'Open in Browser');
                if (open === 'Open in Browser') { vscode.env.openExternal(vscode.Uri.parse(url)); }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`Review post failed: ${msg}`);
                telemetryError('postReview', { outcome: 'error', errorKind: classifyError(err) });
                vscode.window.showErrorMessage(`PR Forge: Could not post review — ${msg}`);
            }
        }
    );
}

async function postInlineReview(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('PR Forge: No workspace folder open.'); return; }
    const config = readConfig(workspaceFolder);
    if (!config) { vscode.window.showErrorMessage('PR Forge: No config found.'); return; }
    const cwd = workspaceFolder.uri.fsPath;

    const prNumber = provider.getState().submittedPrNumber;
    if (!prNumber) {
        vscode.window.showErrorMessage('PR Forge: Submit the PR first, then post an inline review to it.');
        return;
    }

    // Inline comments anchor to the pushed PR head — local HEAD must match the upstream.
    const headSha = getCurrentBranch(cwd) ? execSync('git rev-parse HEAD', { cwd }).toString().trim() : '';
    let upstreamSha = '';
    try { upstreamSha = execSync('git rev-parse @{u}', { cwd }).toString().trim(); } catch { /* no upstream */ }
    if (!upstreamSha || upstreamSha !== headSha) {
        const push = await vscode.window.showWarningMessage(
            'PR Forge: Your local commits are not all pushed. Inline comments anchor to the pushed PR head. Push now?',
            'Push', 'Cancel'
        );
        if (push !== 'Push') { return; }
        try {
            execSync('git push', { cwd });
        } catch (err: unknown) {
            vscode.window.showErrorMessage(`PR Forge: Failed to push — ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
    }

    const apiKey = (await getApiKey(extensionContext, config.provider)) ?? '';
    const providerInfo = PROVIDERS[config.provider];
    if (!providerInfo?.noAuth && !apiKey) {
        vscode.window.showErrorMessage(`PR Forge: No API key set for ${config.provider}.`);
        return;
    }

    // Get remote URL first so we can choose the right auth method
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?');
        return;
    }

    // Pick auth strategy based on remote host
    const isGitLabRemote = /gitlab\.com/i.test(remoteUrl);
    let token: string | undefined;
    if (isGitLabRemote) {
        token = (await getApiKey(extensionContext, 'gitlab')) ?? undefined;
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitLab token. Use "Set API Key" → "GitLab (SCM token)" to store your personal access token (api scope required).');
            return;
        }
    } else {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            token = session.accessToken;
        } catch {
            token = process.env.GITHUB_TOKEN;
        }
        if (!token) {
            vscode.window.showErrorMessage('PR Forge: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
            return;
        }
    }

    const remote = parseRemote(remoteUrl, token);
    if (!remote) { vscode.window.showErrorMessage(`PR Forge: Unsupported remote host. Only GitHub and GitLab are supported. Remote: ${remoteUrl}`); return; }

    const reviewPath = path.join(cwd, config.outputDirectory, 'PR_REVIEW.md');
    const summaryBody = fs.existsSync(reviewPath)
        ? fs.readFileSync(reviewPath, 'utf-8').trim()
        : '_PR Forge inline review._';

    const t0 = Date.now();
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `PR Forge: Posting inline review to PR #${prNumber}...`, cancellable: true },
        async (_progress, progressToken) => {
            const abort = new AbortController();
            progressToken.onCancellationRequested(() => abort.abort());
            try {
                const fileDiffs = getFileDiffs(cwd, config.baseBranch);
                if (fileDiffs.length === 0) {
                    vscode.window.showInformationMessage('PR Forge: No diff against the base branch to review.');
                    return;
                }
                const findings = await generateInlineFindings({ provider: config.provider, apiKey, model: config.defaultModel }, fileDiffs, config.projectName, log, abort.signal);
                if (findings.length === 0) {
                    vscode.window.showInformationMessage('PR Forge: The model reported no inline findings.');
                    return;
                }
                const { comments, dropped } = mapFindingsToComments(findings, fileDiffs);
                if (dropped > 0) { log(`Dropped ${dropped} finding(s) that did not map to a commentable diff line.`); }

                const footer = `\n\n---\n_Inline review by [PR Forge](https://github.com/Mason01Kent/pr-forge)._`;
                try {
                    if (comments.length === 0) { throw new Error('no anchorable comments'); }
                    const { url } = await remote.provider.createReview({ owner: remote.owner, repo: remote.repo, number: prNumber, body: summaryBody + footer, comments });
                    log(`Inline review posted to PR #${prNumber} (${comments.length} comment(s)): ${url}`);
                    telemetryEvent('postInlineReview', { outcome: 'success' }, { durationMs: Date.now() - t0, comments: comments.length, dropped });
                    const open = await vscode.window.showInformationMessage(`Inline review posted to PR #${prNumber} (${comments.length} comment(s)).`, 'Open in Browser');
                    if (open === 'Open in Browser') { vscode.env.openExternal(vscode.Uri.parse(url)); }
                } catch (reviewErr: unknown) {
                    // Graceful fallback: post the findings as one combined comment.
                    log(`Inline review failed (${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}); falling back to a single comment.`);
                    const { url } = await remote.provider.postPrComment({ owner: remote.owner, repo: remote.repo, number: prNumber, body: findingsToFallbackComment(findings) + footer });
                    telemetryEvent('postInlineReview', { outcome: 'fallback' }, { durationMs: Date.now() - t0, comments: comments.length, dropped });
                    const open = await vscode.window.showInformationMessage(`Posted review findings as a single comment on PR #${prNumber} (inline anchoring unavailable).`, 'Open in Browser');
                    if (open === 'Open in Browser') { vscode.env.openExternal(vscode.Uri.parse(url)); }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (classifyError(err) === 'cancelled') { log('Inline review cancelled.'); return; }
                log(`Inline review failed: ${msg}`);
                telemetryError('postInlineReview', { outcome: 'error', errorKind: classifyError(err) });
                vscode.window.showErrorMessage(`PR Forge: Could not post inline review — ${msg}`);
            }
        }
    );
}

function getHeadSha(cwd: string): string | undefined {
    try { return execSync('git rev-parse HEAD', { cwd, timeout: 5000 }).toString().trim(); } catch { return undefined; }
}

/** Start/stop the "re-review on push" poller. Only active while the toggle is on. */
function updateReReviewWatcher(enabled: boolean): void {
    if (reReviewTimer) { clearInterval(reReviewTimer); reReviewTimer = undefined; }
    if (!enabled) { return; }
    const wf = getWorkspaceFolderWithConfig();
    if (!wf) { return; }
    const cwd = wf.uri.fsPath;
    reReviewLastSha = getHeadSha(cwd);
    reReviewTimer = setInterval(() => { void checkForNewCommits(cwd); }, 20_000);
}

/** When new commits land on a branch with a submitted PR, offer to re-run the review. */
async function checkForNewCommits(cwd: string): Promise<void> {
    if (reReviewPrompting) { return; }
    const sha = getHeadSha(cwd);
    if (!sha || sha === reReviewLastSha) { return; }
    reReviewLastSha = sha;
    if (!provider.getState().submittedPrNumber) { return; }
    reReviewPrompting = true;
    try {
        const branch = getCurrentBranch(cwd) ?? 'this branch';
        const choice = await vscode.window.showInformationMessage(
            `PR Forge: New commits detected on ${branch}. Re-run the PR review?`,
            'Re-review', 'Dismiss'
        );
        if (choice === 'Re-review') { await generatePrReview(); }
    } finally {
        reReviewPrompting = false;
    }
}

function getCurrentBranch(workspacePath: string): string | null {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, timeout: 5000 }).toString().trim();
    } catch {
        return null;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    extensionUri = context.extensionUri;
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    log('PR Forge extension activated.');

    const extVersion = context.extension.packageJSON.version as string;
    initTelemetry(extVersion);
    const wfOnActivate = getWorkspaceFolderWithConfig();
    const cfgOnActivate = wfOnActivate ? readConfig(wfOnActivate) : null;
    telemetryEvent('activated', {
        extVersion,
        hasConfig: String(!!cfgOnActivate),
        provider: cfgOnActivate?.provider ?? 'none',
        vscodeVersion: vscode.version,
    });

    statusBarTools = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarTools.command = 'prForge.openProjectConfig';
    statusBarTools.text = '$(tools) PR Forge';
    statusBarTools.tooltip = 'Open PR Forge project config';
    statusBarTools.show();

    statusBarPrBody = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarPrBody.command = 'prForge.generatePrBody';
    statusBarPrBody.text = '$(git-pull-request) PR Body';
    statusBarPrBody.tooltip = 'Generate PR Body';
    statusBarPrBody.show();

    statusBarPrReview = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    statusBarPrReview.command = 'prForge.generatePrReview';
    statusBarPrReview.text = '$(comment-discussion) PR Review';
    statusBarPrReview.tooltip = 'Generate Full PR Review';
    statusBarPrReview.show();

    provider = new SidebarProvider(extensionUri, {
        onReady: async () => {
            await refreshWorkspaceState();
            // Retry once after a short delay — workspace folders may not be
            // fully resolved when the webview fires ready on first load.
            setTimeout(() => { void refreshWorkspaceState(); }, 1500);
        },
        onInitConfig: async () => {
            const wf = await resolveTargetProjectFolder();
            if (wf) {
                await initializeProjectConfig(wf);
                const cfg = readConfig(wf);
                if (cfg) {
                    const keySet = await hasApiKey(context, cfg.provider);
                    provider.updateState({ configExists: true, projectName: cfg.projectName, provider: cfg.provider, providerKeySet: keySet });
                    void refreshWorkspaceState();
                } else {
                    provider.updateState({ configExists: false, projectName: wf.name });
                }
            }
        },
        onOpenConfig: openProjectConfig,
        onGeneratePrBody: generatePrBody,
        onGeneratePrReview: generatePrReview,
        onSubmitPr: submitPr,
        onSubmitDraftPr: submitDraftPr,
        onOpenInbox: openInbox,
        onRefreshReadiness: () => refreshReadiness(),
        onSetApiKey: setApiKey,
        onShowTools: () => {
            provider.updateState({ viewMode: 'tools' });
        },
        onShowPreview: () => {
            provider.updateState({
                viewMode: 'preview',
                previewKind: 'prBody',
                previewTitle: lastBodyContent?.kind === 'prBody' ? lastBodyContent.title : provider.getState().previewTitle,
                previewBody: lastBodyContent ? renderMarkdown(lastBodyContent.body) : provider.getState().previewBody,
            });
        },
        onShowReview: () => {
            provider.updateState({
                viewMode: 'preview',
                previewKind: 'prReview',
                previewTitle: null,
                previewBody: lastReviewContent ? renderMarkdown(lastReviewContent.body) : provider.getState().previewBody,
            });
        },
        onOpenPreviewPanel: () => {
            void openRenderedPreview('prBody');
        },
        onOpenReviewPanel: () => {
            void openRenderedPreview('prReview');
        },
        onOpenReviewThreads: () => {
            void openReviewThreads();
        },
        onCopyPreviewTitle: (title: string) => {
            vscode.env.clipboard.writeText(title);
            vscode.window.showInformationMessage('PR title copied to clipboard');
        },
        onCopyPreviewBody: () => {
            if (lastPreviewMarkdown) {
                vscode.env.clipboard.writeText(lastPreviewMarkdown);
                vscode.window.showInformationMessage('Content copied to clipboard');
            }
        },
        onOpenPrUrl: () => {
            const url = provider.getState().submittedPrUrl;
            if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
        },
        onPostReview: () => { void postReviewToPr(); },
        onPostInlineReview: () => { void postInlineReview(); },
        onClearPr: clearPrOutput,
        onCancel: cancelActiveGeneration,
        onSetModel: (model: string) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.defaultModel = model;
            writeConfig(wf, cfg);
            provider.updateState({ currentModel: model });
            log(`Model changed to ${model}`);
            telemetryEvent('setModel', { model });
            void refreshWorkspaceState();
        },
        onSetRunTests: (value: boolean) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.runTestsOnGenerate = value;
            writeConfig(wf, cfg);
            provider.updateState({ runTestsOnGenerate: value });
            log(`runTestsOnGenerate set to ${value}`);
            void refreshWorkspaceState();
        },
        onSetIncludeRecentCommits: (value: boolean) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.includeRecentCommits = value;
            writeConfig(wf, cfg);
            provider.updateState({ includeRecentCommits: value });
            log(`includeRecentCommits set to ${value}`);
            void refreshWorkspaceState();
        },
        onSetCommitSummaries: (value: boolean) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.includeCommitSummaries = value;
            writeConfig(wf, cfg);
            provider.updateState({ includeCommitSummaries: value });
            log(`includeCommitSummaries set to ${value}`);
            void refreshWorkspaceState();
        },
        onSetFileWalkthrough: (value: boolean) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.includeFileWalkthrough = value;
            writeConfig(wf, cfg);
            provider.updateState({ includeFileWalkthrough: value });
            log(`includeFileWalkthrough set to ${value}`);
            void refreshWorkspaceState();
        },
        onSetReReviewOnPush: (value: boolean) => {
            const wf = getWorkspaceFolderWithConfig();
            if (!wf) { return; }
            const cfg = readConfig(wf);
            if (!cfg) { return; }
            cfg.reReviewOnPush = value;
            writeConfig(wf, cfg);
            provider.updateState({ reReviewOnPush: value });
            log(`reReviewOnPush set to ${value}`);
            updateReReviewWatcher(value);
            void refreshWorkspaceState();
        },
        onRegenerate: regeneratePrBodyWithInstruction,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider));

    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.pr-forge.json');
    const outputWatcher = vscode.workspace.createFileSystemWatcher('**/.pr/**');
    const refreshWatcher = () => { void refreshWorkspaceState(); };
    configWatcher.onDidCreate(refreshWatcher);
    configWatcher.onDidChange(refreshWatcher);
    configWatcher.onDidDelete(refreshWatcher);
    outputWatcher.onDidCreate(refreshWatcher);
    outputWatcher.onDidChange(refreshWatcher);
    outputWatcher.onDidDelete(refreshWatcher);
    workspaceWatchers = [configWatcher, outputWatcher];
    context.subscriptions.push(...workspaceWatchers);

    // Refresh sidebar whenever the workspace changes (e.g. folder opened after extension loaded)
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => { void refreshWorkspaceState(); })
    );

    context.subscriptions.push(vscode.commands.registerCommand('prForge.initializeProjectConfig', async () => {
        const wf = await resolveTargetProjectFolder();
        if (wf) {
            await initializeProjectConfig(wf);
            const cfg = readConfig(wf);
            if (cfg) {
                const keySet = await hasApiKey(context, cfg.provider);
                provider.updateState({ configExists: true, projectName: cfg.projectName, provider: cfg.provider, providerKeySet: keySet });
            } else {
                provider.updateState({ configExists: false, projectName: wf.name });
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.openProjectConfig', openProjectConfig));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.generatePrBody', generatePrBody));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.generatePrReview', generatePrReview));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.submitPr', submitPr));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.submitDraftPr', submitDraftPr));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.openInbox', openInbox));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.openReviewThreads', () => { void openReviewThreads(); }));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.postReview', () => { void postReviewToPr(); }));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.postInlineReview', () => { void postInlineReview(); }));
    context.subscriptions.push(vscode.commands.registerCommand('prForge.setApiKey', setApiKey));
    context.subscriptions.push(outputChannel, statusBarTools, statusBarPrBody, statusBarPrReview);

    log('Commands registered.');
}

export function deactivate(): void {
    if (statusBarTools)    statusBarTools.dispose();
    if (statusBarPrBody)   statusBarPrBody.dispose();
    if (statusBarPrReview) statusBarPrReview.dispose();
    for (const disposable of workspaceWatchers) {
        disposable.dispose();
    }
    if (reReviewTimer) { clearInterval(reReviewTimer); reReviewTimer = undefined; }
    disposeTelemetry();
}
