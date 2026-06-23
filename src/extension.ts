import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SidebarProvider } from './sidebarProvider';
import { PreviewPanel, PreviewContent } from './previewPanel';
import { renderMarkdown } from './markdownRenderer';
import { generatePr } from './prGenerator';
import { PROVIDERS, DEFAULT_MODELS } from './llmClient';
import { getApiKey, hasApiKey, promptSetApiKey } from './secretsManager';
import { parseGitHubRemote, createPullRequest } from './githubClient';

const OUTPUT_CHANNEL_NAME = 'PR Forge';
const CONFIG_FILE_NAME = '.pr-forge.json';

let extensionUri: vscode.Uri;
let extensionContext: vscode.ExtensionContext;

interface PrForgeConfig {
    schemaVersion: number;
    projectName: string;
    baseBranch: string;
    projectType: string;
    testCommand: string;
    outputDirectory: string;
    provider: string;
    defaultModel: string;
    reviewRulesFiles: string[];
    prRiskAreas: string[];
    prBodySections: string[];
}

let outputChannel: vscode.OutputChannel;
let statusBarTools: vscode.StatusBarItem;
let statusBarPrBody: vscode.StatusBarItem;
let statusBarPrReview: vscode.StatusBarItem;
let provider: SidebarProvider;
let lastPreviewMarkdown = '';

function log(msg: string): void {
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
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
        return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as PrForgeConfig;
    } catch (e) {
        log(`Error reading config: ${e}`);
        return null;
    }
}

function writeConfig(workspaceFolder: vscode.WorkspaceFolder, config: PrForgeConfig): void {
    fs.writeFileSync(getConfigPath(workspaceFolder), JSON.stringify(config, null, 2), 'utf-8');
}

async function ensureConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<PrForgeConfig | null> {
    let config = readConfig(workspaceFolder);
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
        schemaVersion: 1, projectName, baseBranch: 'main', projectType,
        testCommand: testCommands[projectType] || '', outputDirectory: '.pr',
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
    const success = await withStatusBarSpinner(statusBarPrBody, '$(git-pull-request) PR Body', async () => {
        try {
            const result = await generatePr({
                workspacePath: workspaceFolder.uri.fsPath,
                baseBranch: config.baseBranch,
                outputDirectory: config.outputDirectory,
                projectName: config.projectName,
                prRiskAreas: config.prRiskAreas,
                prBodySections: config.prBodySections,
                reviewRulesFiles: config.reviewRulesFiles,
                testCommand: config.testCommand,
                generateReview: false,
                llm: { provider: config.provider, apiKey, model: config.defaultModel },
                onLog: (msg) => log(msg),
            });
            PreviewPanel.createOrShow(extensionUri,
                { kind: 'prBody', title: result.title, body: result.body, timestamp: new Date().toLocaleString(), headBranch: result.branch, baseBranch: config.baseBranch },
                workspaceFolder.uri.fsPath, config.outputDirectory
            );
            // Show preview in sidebar too
            lastPreviewMarkdown = result.body;
            provider.updateState({
                viewMode: 'preview',
                previewKind: 'prBody',
                previewTitle: result.title,
                previewBody: renderMarkdown(result.body),
                prBodyReady: true,
            });
            // Reveal the sidebar so the user sees the preview
            vscode.commands.executeCommand('workbench.view.extension.prForge');
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
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
    const success = await withStatusBarSpinner(statusBarPrReview, '$(comment-discussion) PR Review', async () => {
        try {
            const result = await generatePr({
                workspacePath: workspaceFolder.uri.fsPath,
                baseBranch: config.baseBranch,
                outputDirectory: config.outputDirectory,
                projectName: config.projectName,
                prRiskAreas: config.prRiskAreas,
                prBodySections: config.prBodySections,
                reviewRulesFiles: config.reviewRulesFiles,
                testCommand: config.testCommand,
                generateReview: true,
                llm: { provider: config.provider, apiKey, model: config.defaultModel },
                onLog: (msg) => log(msg),
            });
            if (result.review) {
                PreviewPanel.createOrShow(extensionUri,
                    { kind: 'prReview', body: result.review, timestamp: new Date().toLocaleString() },
                    workspaceFolder.uri.fsPath, config.outputDirectory
                );
                // Show preview in sidebar too
                lastPreviewMarkdown = result.review;
                provider.updateState({
                    viewMode: 'preview',
                    previewKind: 'prReview',
                    previewTitle: null,
                    previewBody: renderMarkdown(result.review),
                });
                // Reveal the sidebar so the user sees the preview
                vscode.commands.executeCommand('workbench.view.extension.prForge');
            }
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`Error: ${msg}`);
            vscode.window.showErrorMessage(`PR Forge: ${msg}`);
            return false;
        }
    });
    provider.notifyRunEnd('prReview', success);
    provider.updateState({ configExists: true, projectName: config.projectName, currentBranch: getCurrentBranch(workspaceFolder.uri.fsPath), baseBranch: config.baseBranch });
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
    const remote = parseGitHubRemote(remoteUrl);
    if (!remote) {
        vscode.window.showErrorMessage(`PR Forge: Remote does not look like a GitHub URL: ${remoteUrl}`);
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

    const submitLabel = draft ? 'Submit Draft' : 'Submit';
    const draftLabel = draft ? ' (Draft)' : '';
    const confirm = await vscode.window.showInformationMessage(
        `Submit${draftLabel} PR: "${title}"\n${remote.owner}/${remote.repo}  •  ${headBranch} → ${config.baseBranch}`,
        { modal: true },
        submitLabel
    );
    if (confirm !== submitLabel) return;

    const progressTitle = draft ? 'PR Forge: Submitting draft PR...' : 'PR Forge: Submitting PR...';
    const prType = draft ? 'Draft PR' : 'PR';

    // withProgress closes as soon as this callback resolves — keep it to just the API call
    // so the spinner doesn't hang waiting for the user to click "Open in Browser".
    let prUrl: string | undefined;
    let prNumber: number | undefined;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
        async () => {
            try {
                const result = await createPullRequest({ ...remote, title, body, head: headBranch, base: config.baseBranch, token: token!, draft });
                prUrl = result.url;
                prNumber = result.number;
                log(`${prType} created: ${result.url}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`PR submit failed: ${msg}`);
                vscode.window.showErrorMessage(`PR Forge: PR submit failed — ${msg}`);
            }
        }
    );

    // Show success after the spinner has closed
    if (prUrl && prNumber) {
        provider.updateState({
            submittedPrNumber: prNumber,
            submittedPrUrl: prUrl,
            submittedPrDraft: draft,
            submittedPrTimestamp: new Date().toLocaleTimeString(),
        });
        const open = await vscode.window.showInformationMessage(`${prType} #${prNumber} created!`, 'Open in Browser');
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
        provider.updateState({ configExists: true, projectName: cfg.projectName, provider: cfg.provider, providerKeySet: keySet, currentBranch: branch, baseBranch: cfg.baseBranch });
        await restoreOutputState(wf, cfg);
    } else {
        provider.updateState({ configExists: false, projectName: wf.name, currentBranch: branch, baseBranch: null });
    }
}

export function activate(context: vscode.ExtensionContext): void {
    extensionUri = context.extensionUri;
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    log('PR Forge extension activated.');

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
}
