import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, ChildProcess, execSync } from 'child_process';
import { SidebarProvider } from './sidebarProvider';
import { PreviewPanel, PreviewContent } from './previewPanel';
import { parseGitHubRemote, createPullRequest } from './githubClient';

const OUTPUT_CHANNEL_NAME = 'MasonDevTools';
const CONFIG_FILE_NAME = '.mason-devtools.json';

let extensionPath: string;
let extensionUri: vscode.Uri;

interface MasonDevToolsConfig {
    schemaVersion: number;
    projectName: string;
    baseBranch: string;
    projectType: string;
    testCommand: string;
    outputDirectory: string;
    defaultModel: string;
    reviewRulesFiles: string[];
    prRiskAreas: string[];
    prBodySections: string[];
}

let outputChannel: vscode.OutputChannel;
let statusBarTools: vscode.StatusBarItem;
let statusBarPrBody: vscode.StatusBarItem;
let statusBarPrReview: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

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

function getScriptPath(): string {
    const override = vscode.workspace.getConfiguration('masonDevTools').get<string>('scriptPath');
    if (override && override.trim()) return override.trim();
    return path.join(extensionPath, '..', '..', 'scripts', 'pr-helper', 'New-PrRequest.ps1');
}

function readConfig(workspaceFolder: vscode.WorkspaceFolder): MasonDevToolsConfig | null {
    const configPath = getConfigPath(workspaceFolder);
    if (!fs.existsSync(configPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as MasonDevToolsConfig;
    } catch (e) {
        log(`Error reading config: ${e}`);
        return null;
    }
}

async function ensureConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<MasonDevToolsConfig | null> {
    let config = readConfig(workspaceFolder);
    if (config) return config;
    const choice = await vscode.window.showWarningMessage(`No ${CONFIG_FILE_NAME} found. Initialize project config now?`, 'Yes', 'No');
    if (choice !== 'Yes') return null;
    await initializeProjectConfig(workspaceFolder);
    return readConfig(workspaceFolder);
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
    const config: MasonDevToolsConfig = {
        schemaVersion: 1, projectName, baseBranch: 'main', projectType,
        testCommand: testCommands[projectType] || '', outputDirectory: '.pr',
        defaultModel: 'deepseek-v4-pro', reviewRulesFiles, prRiskAreas,
        prBodySections: ['Summary', 'Why this matters', 'Changes', 'Tests / verification', 'Review focus', 'Risks / follow-ups']
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    log(`Config initialized: ${configPath}`);
    vscode.window.showInformationMessage(`MasonDevTools: Config initialized at ${CONFIG_FILE_NAME}`);
}

async function openProjectConfig(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('MasonDevTools: No workspace folder open.'); return; }
    const configPath = getConfigPath(workspaceFolder);
    if (!fs.existsSync(configPath)) {
        const choice = await vscode.window.showWarningMessage(`No ${CONFIG_FILE_NAME} found. Create one now?`, 'Yes', 'No');
        if (choice === 'Yes') await initializeProjectConfig(workspaceFolder);
        else return;
    }
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
}

async function runPowerShellScript(workspaceFolder: vscode.WorkspaceFolder, config: MasonDevToolsConfig, generateReview: boolean): Promise<boolean> {
    const scriptPath = getScriptPath();
    if (!fs.existsSync(scriptPath)) {
        const msg = `MasonDevTools: PowerShell script not found at ${scriptPath}`;
        log(msg); vscode.window.showErrorMessage(msg); return false;
    }
    if (!process.env.DEEPSEEK_API_KEY) {
        const msg = 'MasonDevTools: DEEPSEEK_API_KEY environment variable is not set.';
        log(msg); vscode.window.showErrorMessage(msg); return false;
    }
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ProjectPath', workspaceFolder.uri.fsPath, '-BaseBranch', config.baseBranch];
    if (generateReview) args.push('-GenerateReview');
    log(`Running: powershell ${args.join(' ')}`);
    return new Promise<boolean>((resolve) => {
        const proc: ChildProcess = spawn('powershell.exe', args, { cwd: workspaceFolder.uri.fsPath, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout?.on('data', (data: Buffer) => log(data.toString().trimEnd()));
        proc.stderr?.on('data', (data: Buffer) => log(`[stderr] ${data.toString().trimEnd()}`));
        proc.on('error', (err: Error) => { log(`Failed to spawn PowerShell: ${err.message}`); vscode.window.showErrorMessage(`MasonDevTools: ${err.message}`); resolve(false); });
        proc.on('close', (code: number | null) => {
            if (code === 0) { log('Script completed successfully.'); resolve(true); }
            else { log(`Script exited with code ${code}`); vscode.window.showErrorMessage(`MasonDevTools: Script exited with code ${code}.`); resolve(false); }
        });
    });
}

async function openGeneratedFile(workspaceFolder: vscode.WorkspaceFolder, config: MasonDevToolsConfig, filename: string): Promise<void> {
    const filePath = path.join(workspaceFolder.uri.fsPath, config.outputDirectory, filename);
    if (fs.existsSync(filePath)) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }
}

async function generatePrBody(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('MasonDevTools: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    sidebarProvider.notifyRunStart('prBody');

    const success = await withStatusBarSpinner(statusBarPrBody, '$(git-pull-request) PR Body', async () => {
        outputChannel.show(true);
        log('Generating PR Body...');
        return runPowerShellScript(workspaceFolder, config, false);
    });

    if (success) {
        const titlePath = path.join(workspaceFolder.uri.fsPath, config.outputDirectory, 'PR_TITLE.txt');
        const bodyPath = path.join(workspaceFolder.uri.fsPath, config.outputDirectory, 'PR_BODY.md');
        let title = '';
        let body = '';
        if (fs.existsSync(titlePath)) title = fs.readFileSync(titlePath, 'utf-8').trim();
        if (fs.existsSync(bodyPath)) body = fs.readFileSync(bodyPath, 'utf-8');
        const content: PreviewContent = { kind: 'prBody', title, body, timestamp: new Date().toLocaleString() };
        PreviewPanel.createOrShow(extensionUri, content, workspaceFolder.uri.fsPath, config.outputDirectory);
        await openGeneratedFile(workspaceFolder, config, 'PR_BODY.md');
    }

    sidebarProvider.notifyRunEnd('prBody', success);
}

async function generatePrReview(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('MasonDevTools: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    sidebarProvider.notifyRunStart('prReview');

    const success = await withStatusBarSpinner(statusBarPrReview, '$(comment-discussion) PR Review', async () => {
        outputChannel.show(true);
        log('Generating Full PR Review...');
        return runPowerShellScript(workspaceFolder, config, true);
    });

    if (success) {
        const reviewPath = path.join(workspaceFolder.uri.fsPath, config.outputDirectory, 'PR_REVIEW.md');
        if (fs.existsSync(reviewPath)) {
            const review = fs.readFileSync(reviewPath, 'utf-8');
            const content: PreviewContent = { kind: 'prReview', body: review, timestamp: new Date().toLocaleString() };
            PreviewPanel.createOrShow(extensionUri, content, workspaceFolder.uri.fsPath, config.outputDirectory);
        }
        await openGeneratedFile(workspaceFolder, config, 'PR_REVIEW.md');
    }

    sidebarProvider.notifyRunEnd('prReview', success);
}

async function submitPr(): Promise<void> {
    const workspaceFolder = await resolveTargetProjectFolder();
    if (!workspaceFolder) { vscode.window.showErrorMessage('MasonDevTools: No workspace folder open.'); return; }
    const config = await ensureConfig(workspaceFolder);
    if (!config) return;

    const outputDir = path.join(workspaceFolder.uri.fsPath, config.outputDirectory);
    const titlePath = path.join(outputDir, 'PR_TITLE.txt');
    const bodyPath  = path.join(outputDir, 'PR_BODY.md');

    if (!fs.existsSync(titlePath) || !fs.existsSync(bodyPath)) {
        vscode.window.showErrorMessage('MasonDevTools: Generate a PR Body first before submitting.');
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
        vscode.window.showErrorMessage('MasonDevTools: No GitHub token. Sign in to GitHub in VS Code or set GITHUB_TOKEN env var.');
        return;
    }

    // Get remote URL
    let remoteUrl: string;
    try {
        remoteUrl = execSync('git remote get-url origin', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('MasonDevTools: Could not get git remote URL. Is "origin" set?');
        return;
    }
    const remote = parseGitHubRemote(remoteUrl);
    if (!remote) {
        vscode.window.showErrorMessage(`MasonDevTools: Remote does not look like a GitHub URL: ${remoteUrl}`);
        return;
    }

    // Get current branch
    let headBranch: string;
    try {
        headBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceFolder.uri.fsPath }).toString().trim();
    } catch {
        vscode.window.showErrorMessage('MasonDevTools: Could not determine current branch.');
        return;
    }

    const title = fs.readFileSync(titlePath, 'utf-8').trim();
    const body  = fs.readFileSync(bodyPath,  'utf-8');

    const confirm = await vscode.window.showInformationMessage(
        `Submit PR: "${title}"\n${remote.owner}/${remote.repo}  •  ${headBranch} → ${config.baseBranch}`,
        { modal: true },
        'Submit'
    );
    if (confirm !== 'Submit') return;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'MasonDevTools: Submitting PR...', cancellable: false },
        async () => {
            try {
                const result = await createPullRequest({ ...remote, title, body, head: headBranch, base: config.baseBranch, token: token! });
                log(`PR created: ${result.url}`);
                const open = await vscode.window.showInformationMessage(`PR #${result.number} created!`, 'Open in Browser');
                if (open === 'Open in Browser') vscode.env.openExternal(vscode.Uri.parse(result.url));
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`PR submit failed: ${msg}`);
                vscode.window.showErrorMessage(`MasonDevTools: PR submit failed — ${msg}`);
            }
        }
    );
}

export function activate(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;
    extensionUri = context.extensionUri;
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    log('MasonDevTools extension activated.');

    statusBarTools = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarTools.command = 'masonDevTools.openProjectConfig';
    statusBarTools.text = '$(tools) MasonDevTools';
    statusBarTools.tooltip = 'Open MasonDevTools project config';
    statusBarTools.show();

    statusBarPrBody = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarPrBody.command = 'masonDevTools.generatePrBody';
    statusBarPrBody.text = '$(git-pull-request) PR Body';
    statusBarPrBody.tooltip = 'Generate PR Body';
    statusBarPrBody.show();

    statusBarPrReview = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    statusBarPrReview.command = 'masonDevTools.generatePrReview';
    statusBarPrReview.text = '$(comment-discussion) PR Review';
    statusBarPrReview.tooltip = 'Generate Full PR Review';
    statusBarPrReview.show();

    sidebarProvider = new SidebarProvider(extensionUri, {
        onInitConfig: async () => {
            const wf = await resolveTargetProjectFolder();
            if (wf) {
                await initializeProjectConfig(wf);
                const cfg = readConfig(wf);
                sidebarProvider.updateState({ configExists: cfg !== null, projectName: cfg?.projectName ?? wf.name });
            }
        },
        onOpenConfig: openProjectConfig,
        onGeneratePrBody: generatePrBody,
        onGeneratePrReview: generatePrReview,
        onSubmitPr: submitPr,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider));

    context.subscriptions.push(vscode.commands.registerCommand('masonDevTools.initializeProjectConfig', async () => {
        const wf = await resolveTargetProjectFolder();
        if (wf) {
            await initializeProjectConfig(wf);
            const cfg = readConfig(wf);
            sidebarProvider.updateState({ configExists: cfg !== null, projectName: cfg?.projectName ?? wf.name });
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('masonDevTools.openProjectConfig', openProjectConfig));
    context.subscriptions.push(vscode.commands.registerCommand('masonDevTools.generatePrBody', generatePrBody));
    context.subscriptions.push(vscode.commands.registerCommand('masonDevTools.generatePrReview', generatePrReview));
    context.subscriptions.push(vscode.commands.registerCommand('masonDevTools.submitPr', submitPr));
    context.subscriptions.push(outputChannel, statusBarTools, statusBarPrBody, statusBarPrReview);

    log('Commands registered.');
}

export function deactivate(): void {
    if (statusBarTools)    statusBarTools.dispose();
    if (statusBarPrBody)   statusBarPrBody.dispose();
    if (statusBarPrReview) statusBarPrReview.dispose();
}
