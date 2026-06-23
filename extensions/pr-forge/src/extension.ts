import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SidebarProvider } from './sidebarProvider';
import { PreviewPanel } from './previewPanel';
import { renderMarkdown } from './markdownRenderer';
import { generatePr, regeneratePr, clearDiffCache } from './prGenerator';
import { PrForgeConfig, migrateConfig } from './config';
import { PROVIDERS, DEFAULT_MODELS, STATIC_MODELS, listModels, UsageStats } from './llmClient';
import { getApiKey, hasApiKey, promptSetApiKey } from './secretsManager';
import { parseRemote } from './scm/index';
import { initTelemetry, disposeTelemetry, telemetryEvent, telemetryError, classifyError } from './telemetry';

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

function log(msg: string): void {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function logUsage(usage: UsageStats): void {
    const cost = usage.estimatedCostUsd !== undefined
        ? ` | est. cost $${usage.estimatedCostUsd.toFixed(4)}`
        : '';
    log(`Tokens: ${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out${cost}`);
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
async function restoreOutputState(workspaceFolder: vscode.WorkspaceFolder, config: PrForgeConfig): Promise<void> {
    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const titlePath = path.join(outputDir, 'PR_TITLE.txt');
    const bodyPath  = path.join(outputDir, 'PR_BODY.md');
    const reviewPath = path.join(outputDir, 'PR_REVIEW.md');

    if (!fs.existsSync(bodyPath)) {
        return; // nothing to restore
    }

    const title = fs.existsSync(titlePath) ? fs.readFileSync(titlePath, 'utf-8').trim() : '';
    const body  = fs.readFileSync(bodyPath, 'utf-8');
    const reviewExists = fs.existsSync(reviewPath);

    // Use the most recent file's mtime as the "last run" timestamp
    const bodyTime = fs.statSync(bodyPath).mtime;
    const reviewTime = reviewExists ? fs.statSync(reviewPath).mtime : new Date(0);
    const mostRecent = bodyTime > reviewTime ? bodyTime : reviewTime;

    lastPreviewMarkdown = body;

    const timestamp = mostRecent.toLocaleTimeString();
    const lastRunType: 'prBody' | 'prReview' = reviewExists && reviewTime >= bodyTime ? 'prReview' : 'prBody';

    provider.updateState({
        prBodyReady: true,
        lastRunType,
        lastRunStatus: 'success',
        lastRunTimestamp: timestamp,
        viewMode: 'tools',
        previewKind: lastRunType,
        previewTitle: title || null,
        previewBody: renderMarkdown(lastRunType === 'prReview' ? fs.readFileSync(reviewPath, 'utf-8') : body),
    });

    log(`Restored output state from ${outputDir} (${lastRunType}, ${timestamp})`);
}

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
    clearDiffCache();
    provider.updateState({
        prBodyReady: false,
        lastRunType: null,
        lastRunStatus: null,
        lastRunTimestamp: null,
        previewTitle: null,
        previewBody: null,
        submittedPrNumber: null,
        submittedPrUrl: null,
        submittedPrTimestamp: null,
        viewMode: 'tools',
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
    const isSellWise = projectName.toLowerCase().includes('sellwise') || workspaceFolder.name.toLowerCase().includes('sellwise');
    const prRiskAreas = isSellWise
        ? ['authentication', 'authorization', 'ownership isolation', 'PostgreSQL migrations', 'decimal money handling', 'inventory transactions', 'refunds', 'production readiness', 'config/secrets safety']
        : ['security', 'tests', 'configuration', 'data integrity', 'deployment risk'];
    const config: PrForgeConfig = {
        schemaVersion: 2, projectName, baseBranch: 'main', projectType,
        testCommand: testCommands[projectType] || '', runTestsOnGenerate: true,
        outputDirectory: '.pr',
        provider: 'deepseek', defaultModel: 'deepseek-chat',
        reviewRulesFiles, prRiskAreas,
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
    if (!providerInfo?.noAuth && !apiKey) {
        const set = await vscode.window.showErrorMessage(
            `PR Forge: No API key set for ${config.provider}. Set one now?`, 'Set Key'
        );
        if (set === 'Set Key') await promptSetApiKey(extensionContext, config.provider);
        return;
    }

    outputChannel.show(true);
    provider.notifyRunStart('prBody');
    // Switch sidebar to preview immediately so streaming tokens appear live
    provider.updateState({ viewMode: 'preview', previewKind: 'prBody', previewTitle: null, previewBody: '' });
    vscode.commands.executeCommand('workbench.view.extension.prForge');

    const abortController = new AbortController();
    let throttleTimer: ReturnType<typeof setTimeout> | undefined;
    let accumulatedBody = '';
    const t0 = Date.now();

    const success = await withStatusBarSpinner(statusBarPrBody, '$(git-pull-request) PR Body', async () => {
        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Generating PR Body...', cancellable: true },
                async (_progress, token) => {
                    token.onCancellationRequested(() => abortController.abort());
                    return generatePr({
                        workspacePath: workspaceFolder.uri.fsPath,
                        baseBranch: config.baseBranch,
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        testCommand: config.testCommand,
                        runTests: config.runTestsOnGenerate ?? true,
                        generateReview: false,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg) => log(msg),
                        signal: abortController.signal,
                        onToken: (delta) => {
                            accumulatedBody += delta;
                            if (throttleTimer) { return; }
                            throttleTimer = setTimeout(() => {
                                throttleTimer = undefined;
                                provider.updateState({ previewBody: renderMarkdown(accumulatedBody) });
                            }, 100);
                        },
                    });
                }
            );
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            logUsage(result.usage);
            telemetryEvent('generate.prBody', { provider: config.provider, model: config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            PreviewPanel.createOrShow(extensionUri,
                { kind: 'prBody', title: result.title, body: result.body, timestamp: new Date().toLocaleString(), headBranch: result.branch, baseBranch: config.baseBranch },
                workspaceFolder.uri.fsPath, config.outputDirectory
            );
            lastPreviewMarkdown = result.body;
            provider.updateState({
                viewMode: 'preview',
                previewKind: 'prBody',
                previewTitle: result.title,
                previewBody: renderMarkdown(result.body),
                prBodyReady: true,
            });
            return true;
        } catch (err: unknown) {
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('generate.prBody', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Generation cancelled.');
                provider.updateState({ viewMode: 'tools' });
                return false;
            }
            telemetryError('generate.prBody', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    provider.notifyRunEnd('prBody', success);
    provider.updateState({ configExists: true, projectName: config.projectName, currentBranch: getCurrentBranch(workspaceFolder.uri.fsPath), baseBranch: config.baseBranch });
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
        const set = await vscode.window.showErrorMessage(
            `PR Forge: No API key set for ${config.provider}. Set one now?`, 'Set Key'
        );
        if (set === 'Set Key') await promptSetApiKey(extensionContext, config.provider);
        return;
    }

    outputChannel.show(true);
    provider.notifyRunStart('prReview');
    provider.updateState({ viewMode: 'preview', previewKind: 'prReview', previewTitle: null, previewBody: '' });
    vscode.commands.executeCommand('workbench.view.extension.prForge');

    const abortController = new AbortController();
    let throttleTimer: ReturnType<typeof setTimeout> | undefined;
    let accumulatedReview = '';
    const t0 = Date.now();

    const success = await withStatusBarSpinner(statusBarPrReview, '$(comment-discussion) PR Review', async () => {
        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'PR Forge: Generating PR Review...', cancellable: true },
                async (_progress, token) => {
                    token.onCancellationRequested(() => abortController.abort());
                    return generatePr({
                        workspacePath: workspaceFolder.uri.fsPath,
                        baseBranch: config.baseBranch,
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        testCommand: config.testCommand,
                        runTests: config.runTestsOnGenerate ?? true,
                        generateReview: true,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg) => log(msg),
                        signal: abortController.signal,
                        onToken: (delta) => {
                            accumulatedReview += delta;
                            if (throttleTimer) { return; }
                            throttleTimer = setTimeout(() => {
                                throttleTimer = undefined;
                                provider.updateState({ previewBody: renderMarkdown(accumulatedReview) });
                            }, 100);
                        },
                    });
                }
            );
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            logUsage(result.usage);
            telemetryEvent('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            if (result.review) {
                PreviewPanel.createOrShow(extensionUri,
                    { kind: 'prReview', body: result.review, timestamp: new Date().toLocaleString() },
                    workspaceFolder.uri.fsPath, config.outputDirectory
                );
                lastPreviewMarkdown = result.review;
                provider.updateState({
                    viewMode: 'preview',
                    previewKind: 'prReview',
                    previewTitle: null,
                    previewBody: renderMarkdown(result.review),
                });
            }
            return true;
        } catch (err: unknown) {
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Generation cancelled.');
                provider.updateState({ viewMode: 'tools' });
                return false;
            }
            telemetryError('generate.prReview', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    provider.notifyRunEnd('prReview', success);
    provider.updateState({ configExists: true, projectName: config.projectName, currentBranch: getCurrentBranch(workspaceFolder.uri.fsPath), baseBranch: config.baseBranch });
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
    provider.updateState({ viewMode: 'preview', previewKind: 'prBody', previewBody: '' });

    const abortController = new AbortController();
    let throttleTimer: ReturnType<typeof setTimeout> | undefined;
    let accumulatedBody = '';
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
                        outputDirectory: config.outputDirectory,
                        projectName: config.projectName,
                        prRiskAreas: config.prRiskAreas,
                        prBodySections: config.prBodySections,
                        reviewRulesFiles: config.reviewRulesFiles,
                        testCommand: config.testCommand,
                        runTests: false,
                        generateReview: false,
                        llm: { provider: config.provider, apiKey, model: config.defaultModel },
                        onLog: (msg) => log(msg),
                        signal: abortController.signal,
                        onToken: (delta) => {
                            accumulatedBody += delta;
                            if (throttleTimer) { return; }
                            throttleTimer = setTimeout(() => {
                                throttleTimer = undefined;
                                provider.updateState({ previewBody: renderMarkdown(accumulatedBody) });
                            }, 100);
                        },
                    }, previousDraft, instruction);
                }
            );
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            logUsage(result.usage);
            telemetryEvent('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'success' }, { durationMs: Date.now() - t0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(result.usage.estimatedCostUsd !== undefined ? { estCostUsd: result.usage.estimatedCostUsd } : {}) });
            lastPreviewMarkdown = result.body;
            provider.updateState({
                viewMode: 'preview',
                previewKind: 'prBody',
                previewTitle: result.title,
                previewBody: renderMarkdown(result.body),
                prBodyReady: true,
            });
            return true;
        } catch (err: unknown) {
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = undefined; }
            const msg = err instanceof Error ? err.message : String(err);
            const kind = classifyError(err);
            if (kind === 'cancelled') {
                telemetryEvent('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'cancelled' }, { durationMs: Date.now() - t0 });
                log('Regeneration cancelled.');
                provider.updateState({ viewMode: 'preview' });
                return false;
            }
            telemetryError('regenerate', { provider: config.provider, model: config.defaultModel, outcome: 'error', errorKind: kind }, { durationMs: Date.now() - t0 });
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
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
    }
}

async function submitDraftPr(): Promise<void> {
    await submitPrInternal(true);
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

    // GitHub auth: try VS Code built-in first, then GITHUB_TOKEN env var
    let token: string | undefined;
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

    // Get remote URL
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('PR Forge: Could not get git remote URL. Is "origin" set?');
        return;
    }
    const remote = parseRemote(remoteUrl, token!);
    if (!remote) {
        vscode.window.showErrorMessage(`PR Forge: Remote URL not recognised as a supported SCM host: ${remoteUrl}`);
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
                    const result = await scm.updatePr({ owner, repo, number: existingPr!.number, title, body, head: headBranch, base: config.baseBranch, token: token! });
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
                    const result = await scm.createPr({ owner, repo, title, body, head: headBranch, base: config.baseBranch, token: token!, draft });
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
        const actionLabel = existingPr ? `PR #${prNumber} updated!` : `${draft ? 'Draft PR' : 'PR'} #${prNumber} created!`;
        const open = await vscode.window.showInformationMessage(actionLabel, 'Open in Browser');
        if (open === 'Open in Browser') { vscode.env.openExternal(vscode.Uri.parse(prUrl)); }
    }
}

function getCurrentBranch(workspacePath: string): string | null {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, timeout: 5000 }).toString().trim();
    } catch {
        return null;
    }
}

async function refreshSidebarState(context: vscode.ExtensionContext): Promise<void> {
    const wf = getWorkspaceFolderWithConfig();
    if (!wf) return;
    const cfg = readConfig(wf);
    const branch = getCurrentBranch(wf.uri.fsPath);
    if (cfg) {
        const keySet = await hasApiKey(context, cfg.provider);
        const onBase = branch !== null && branch === cfg.baseBranch;
        const staticModels = STATIC_MODELS[cfg.provider] ?? [];
        const immediateModels = staticModels.includes(cfg.defaultModel)
            ? staticModels
            : [cfg.defaultModel, ...staticModels].filter(Boolean);
        provider.updateState({
            configExists: true, projectName: cfg.projectName, provider: cfg.provider,
            providerKeySet: keySet, currentBranch: branch, baseBranch: cfg.baseBranch,
            currentModel: cfg.defaultModel, runTestsOnGenerate: cfg.runTestsOnGenerate ?? true,
            availableModels: immediateModels,
        });
        // Fetch live models in the background and update the dropdown when ready
        const apiKey = (await getApiKey(context, cfg.provider)) ?? '';
        listModels({ provider: cfg.provider, apiKey, model: cfg.defaultModel })
            .then(models => provider.updateState({ availableModels: models, currentModel: cfg.defaultModel }))
            .catch(() => { /* non-fatal */ });
        if (onBase) {
            provider.updateState({ prBodyReady: false, lastRunType: null, lastRunStatus: null, lastRunTimestamp: null, previewTitle: null, previewBody: null });
        } else {
            await restoreOutputState(wf, cfg);
        }
    } else {
        provider.updateState({ configExists: false, projectName: wf.name, currentBranch: branch, baseBranch: null, availableModels: [] });
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
            await refreshSidebarState(context);
            // Retry once after a short delay — workspace folders may not be
            // fully resolved when the webview fires ready on first load.
            setTimeout(() => refreshSidebarState(context), 1500);
        },
        onInitConfig: async () => {
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
        },
        onOpenConfig: openProjectConfig,
        onGeneratePrBody: generatePrBody,
        onGeneratePrReview: generatePrReview,
        onSubmitPr: submitPr,
        onSubmitDraftPr: submitDraftPr,
        onSetApiKey: setApiKey,
        onShowTools: () => {
            provider.updateState({ viewMode: 'tools' });
        },
        onShowPreview: () => {
            provider.updateState({ viewMode: 'preview' });
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
        onClearPr: clearPrOutput,
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
        },
        onRegenerate: regeneratePrBodyWithInstruction,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider));

    // Refresh sidebar whenever the workspace changes (e.g. folder opened after extension loaded)
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => refreshSidebarState(context))
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
    context.subscriptions.push(vscode.commands.registerCommand('prForge.setApiKey', setApiKey));
    context.subscriptions.push(outputChannel, statusBarTools, statusBarPrBody, statusBarPrReview);

    log('Commands registered.');
}

export function deactivate(): void {
    if (statusBarTools)    statusBarTools.dispose();
    if (statusBarPrBody)   statusBarPrBody.dispose();
    if (statusBarPrReview) statusBarPrReview.dispose();
    disposeTelemetry();
}
