import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface SidebarState {
    projectName: string | null;
    configExists: boolean;
    provider: string | null;
    providerKeySet: boolean;
    lastRunType: 'prBody' | 'prReview' | null;
    lastRunStatus: 'success' | 'error' | null;
    lastRunTimestamp: string | null;
    isRunning: boolean;
    prBodyReady: boolean;
    viewMode: 'tools' | 'preview';
    previewKind: 'prBody' | 'prReview' | null;
    previewTitle: string | null;
    previewBody: string | null;
    submittedPrNumber: number | null;
    submittedPrUrl: string | null;
    submittedPrDraft: boolean;
    submittedPrTimestamp: string | null;
    currentBranch: string | null;
    baseBranch: string | null;
}

type WebviewToExtMsg =
    | { command: 'initConfig' }
    | { command: 'openConfig' }
    | { command: 'generatePrBody' }
    | { command: 'generatePrReview' }
    | { command: 'submitPr' }
    | { command: 'submitDraftPr' }
    | { command: 'setApiKey' }
    | { command: 'ready' }
    | { command: 'showTools' }
    | { command: 'showPreview' }
    | { command: 'copyPreviewTitle' }
    | { command: 'copyPreviewBody' }
    | { command: 'openPrUrl' };

type ExtToWebviewMsg =
    | { type: 'stateUpdate'; state: SidebarState }
    | { type: 'runStart'; runType: 'prBody' | 'prReview' }
    | { type: 'runEnd'; runType: 'prBody' | 'prReview'; success: boolean; timestamp: string };

export interface SidebarCallbacks {
    onReady: () => Promise<void>;
    onInitConfig: () => Promise<void>;
    onOpenConfig: () => Promise<void>;
    onGeneratePrBody: () => Promise<void>;
    onGeneratePrReview: () => Promise<void>;
    onSubmitPr: () => Promise<void>;
    onSubmitDraftPr: () => Promise<void>;
    onSetApiKey: () => Promise<void>;
    onShowTools: () => void;
    onShowPreview: () => void;
    onCopyPreviewTitle: (title: string) => void;
    onCopyPreviewBody: () => void;
    onOpenPrUrl: () => void;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'prForge.sidebar';

    private _view?: vscode.WebviewView;
    private _state: SidebarState = {
        projectName: null,
        configExists: false,
        provider: null,
        providerKeySet: false,
        lastRunType: null,
        lastRunStatus: null,
        lastRunTimestamp: null,
        isRunning: false,
        prBodyReady: false,
        viewMode: 'tools',
        previewKind: null,
        previewTitle: null,
        previewBody: null,
        submittedPrNumber: null,
        submittedPrUrl: null,
        submittedPrDraft: false,
        submittedPrTimestamp: null,
        currentBranch: null,
        baseBranch: null,
    };  

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _callbacks: SidebarCallbacks
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg: WebviewToExtMsg) => {
            switch (msg.command) {
                case 'ready':
                    this._post({ type: 'stateUpdate', state: this._state });
                    this._callbacks.onReady();
                    break;
                case 'initConfig':
                    this._callbacks.onInitConfig();
                    break;
                case 'openConfig':
                    this._callbacks.onOpenConfig();
                    break;
                case 'generatePrBody':
                    this._callbacks.onGeneratePrBody();
                    break;
                case 'generatePrReview':
                    this._callbacks.onGeneratePrReview();
                    break;
                case 'submitPr':
                    this._callbacks.onSubmitPr();
                    break;
                case 'submitDraftPr':
                    this._callbacks.onSubmitDraftPr();
                    break;
                case 'setApiKey':
                    this._callbacks.onSetApiKey();
                    break;
                case 'showTools':
                    this._callbacks.onShowTools();
                    break;
                case 'showPreview':
                    this._callbacks.onShowPreview();
                    break;
                case 'copyPreviewTitle':
                    if (this._state.previewTitle) {
                        this._callbacks.onCopyPreviewTitle(this._state.previewTitle);
                    }
                    break;
                case 'copyPreviewBody':
                    this._callbacks.onCopyPreviewBody();
                    break;
                case 'openPrUrl':
                    this._callbacks.onOpenPrUrl();
                    break;
            }
        });
    }

    public getState(): SidebarState { return this._state; }

    public updateState(partial: Partial<SidebarState>): void {
        this._state = { ...this._state, ...partial };
        this._post({ type: 'stateUpdate', state: this._state });
    }

    public notifyRunStart(runType: 'prBody' | 'prReview'): void {
        this._state.isRunning = true;
        this._state.lastRunType = runType;
        this._post({ type: 'runStart', runType });
    }

    public notifyRunEnd(runType: 'prBody' | 'prReview', success: boolean): void {
        this._state.isRunning = false;
        this._state.lastRunStatus = success ? 'success' : 'error';
        this._state.lastRunTimestamp = new Date().toLocaleTimeString();
        if (runType === 'prBody' && success) this._state.prBodyReady = true;
        this._post({ type: 'runEnd', runType, success, timestamp: this._state.lastRunTimestamp });
    }

    private _post(msg: ExtToWebviewMsg): void {
        this._view?.webview.postMessage(msg);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.css')
        );

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource};
                 script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>PR Forge</title>
</head>
<body>

<!-- ====== TOOLS VIEW ====== -->
<div id="tools-view">
  <div class="header">
    <span class="header-icon">⬡</span>
    <h2 class="header-title">PR Forge</h2>
  </div>

  <div class="card" id="status-card">
    <div class="card-row">
      <span class="label">Project</span>
      <span class="value" id="project-name">—</span>
    </div>
    <div class="card-row">
      <span class="label">Config</span>
      <span class="badge warn" id="config-badge">Not found</span>
    </div>
    <div class="card-row">
      <span class="label">Provider</span>
      <span class="value" id="provider-name">—</span>
    </div>
    <div class="card-row">
      <span class="label">API Key</span>
      <span class="badge warn" id="key-badge">Not set</span>
    </div>
    <div class="card-row" id="branch-row" style="display:none">
      <span class="label">Branch</span>
      <span class="value" id="branch-name"></span>
    </div>
    <div class="card-row" id="last-run-row" style="display:none">
      <span class="label">Last run</span>
      <span class="value" id="last-run-info"></span>
    </div>
    <div class="card-row" id="submitted-pr-row" style="display:none">
      <span class="label">Submitted</span>
      <button class="btn-link" id="btn-submitted-pr-link"></button>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-secondary" id="btn-set-key">🔑 Set API Key</button>
    <button class="btn btn-secondary" id="btn-init-config">⚙ Init Config</button>
    <button class="btn btn-secondary" id="btn-open-config">✎ Open Config</button>
    <hr class="divider">
    <button class="btn btn-primary" id="btn-pr-body">
      <span id="btn-pr-body-label">⇄ Generate PR Body</span>
    </button>
    <button class="btn btn-primary" id="btn-pr-review">
      <span id="btn-pr-review-label">✦ Generate PR Review</span>
    </button>
    <hr class="divider">
    <button class="btn btn-secondary" id="btn-view-summary" disabled>📄 View PR Preview</button>
    <button class="btn btn-submit" id="btn-submit-pr" disabled>↑ Submit PR to GitHub</button>
    <button class="btn btn-submit-draft" id="btn-submit-draft-pr" disabled>📝 Submit as Draft PR</button>
  </div>

  <div class="status-area" id="status-area" style="display:none">
    <div class="spinner"></div>
    <span id="status-message">Running...</span>
  </div>
</div>

<!-- ====== PREVIEW VIEW ====== -->
<div id="preview-view" style="display:none">
  <div class="preview-header">
    <button class="btn btn-back" id="btn-back">← Back</button>
    <span class="preview-header-title" id="preview-header-title">PR Body</span>
  </div>
  <div class="preview-actions" id="preview-actions">
    <button class="btn btn-preview-action" id="btn-preview-copy-title" style="display:none">📋 Copy Title</button>
    <button class="btn btn-preview-action" id="btn-preview-copy-body">📋 Copy Body</button>
    <button class="btn btn-preview-action btn-preview-draft" id="btn-preview-draft" style="display:none">📝 Submit Draft</button>
    <button class="btn btn-preview-action btn-preview-submit" id="btn-preview-submit" style="display:none">↑ Submit PR</button>
  </div>
  <!-- GitHub-style title shown for PR Body previews -->
  <div class="gh-pr-title-bar" id="gh-pr-title-bar" style="display:none">
    <div class="gh-pr-title-bar-label">PR Title</div>
    <div class="gh-pr-title-bar-text" id="gh-pr-title-text"></div>
  </div>
  <div class="preview-content" id="preview-content"></div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const el = (id) => document.getElementById(id);
  const toolsView = el('tools-view');
  const previewView = el('preview-view');

  // Tools view buttons
  const allBtns = ['btn-set-key','btn-init-config','btn-open-config','btn-pr-body','btn-pr-review','btn-view-summary','btn-submit-pr','btn-submit-draft-pr'].map(el);
  el('btn-set-key').addEventListener('click',          () => vscode.postMessage({ command: 'setApiKey' }));
  el('btn-init-config').addEventListener('click',       () => vscode.postMessage({ command: 'initConfig' }));
  el('btn-open-config').addEventListener('click',       () => vscode.postMessage({ command: 'openConfig' }));
  el('btn-pr-body').addEventListener('click',           () => vscode.postMessage({ command: 'generatePrBody' }));
  el('btn-pr-review').addEventListener('click',         () => vscode.postMessage({ command: 'generatePrReview' }));
  el('btn-submit-pr').addEventListener('click',         () => vscode.postMessage({ command: 'submitPr' }));
  el('btn-submit-draft-pr').addEventListener('click',   () => vscode.postMessage({ command: 'submitDraftPr' }));
  el('btn-view-summary').addEventListener('click',      () => vscode.postMessage({ command: 'showPreview' }));
  el('btn-submitted-pr-link').addEventListener('click', () => vscode.postMessage({ command: 'openPrUrl' }));

  // Preview view buttons
  el('btn-back').addEventListener('click', () => vscode.postMessage({ command: 'showTools' }));
  el('btn-preview-copy-title').addEventListener('click', () => vscode.postMessage({ command: 'copyPreviewTitle' }));
  el('btn-preview-copy-body').addEventListener('click',  () => vscode.postMessage({ command: 'copyPreviewBody' }));
  el('btn-preview-submit').addEventListener('click',     () => vscode.postMessage({ command: 'submitPr' }));
  el('btn-preview-draft').addEventListener('click',      () => vscode.postMessage({ command: 'submitDraftPr' }));

  function switchView(mode) {
    if (mode === 'preview') {
      toolsView.style.display = 'none';
      previewView.style.display = 'flex';
      previewView.style.flexDirection = 'column';
    } else {
      toolsView.style.display = '';
      previewView.style.display = 'none';
    }
  }

  function applyState(state) {
    // Switch view
    switchView(state.viewMode || 'tools');

    // Tools view fields
    el('project-name').textContent = state.projectName || '—';
    const badge = el('config-badge');
    if (state.configExists) {
      badge.textContent = 'Found ✓';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Not found';
      badge.className = 'badge warn';
    }
    el('provider-name').textContent = state.provider ? state.provider.charAt(0).toUpperCase() + state.provider.slice(1) : '—';
    const keyBadge = el('key-badge');
    const noAuth = state.provider === 'ollama';
    keyBadge.textContent = noAuth ? 'Not needed' : (state.providerKeySet ? 'Set ✓' : 'Not set');
    keyBadge.className   = (noAuth || state.providerKeySet) ? 'badge ok' : 'badge warn';

    if (state.lastRunTimestamp) {
      const label = state.lastRunType === 'prBody' ? 'PR Body' : 'PR Review';
      const icon  = state.lastRunStatus === 'success' ? '✓' : '✗';
      el('last-run-info').textContent = icon + ' ' + label + ' · ' + state.lastRunTimestamp;
      el('last-run-row').style.display = '';
    }

    if (state.submittedPrNumber && state.submittedPrTimestamp) {
      const draftTag = state.submittedPrDraft ? ' (Draft)' : '';
      el('btn-submitted-pr-link').textContent = '↗ PR #' + state.submittedPrNumber + draftTag + ' · ' + state.submittedPrTimestamp;
      el('submitted-pr-row').style.display = '';
    } else {
      el('submitted-pr-row').style.display = 'none';
    }

    // Branch display
    if (state.currentBranch) {
      const onBase = state.currentBranch === state.baseBranch;
      const branchEl = el('branch-name');
      branchEl.textContent = state.currentBranch;
      branchEl.className = 'value' + (onBase ? ' branch-warn' : '');
      el('branch-row').style.display = '';
    } else {
      el('branch-row').style.display = 'none';
    }

    const onBaseBranch = state.currentBranch !== null && state.currentBranch === state.baseBranch;
    const canSubmit = state.prBodyReady && !onBaseBranch;
    el('btn-submit-pr').disabled      = !canSubmit;
    el('btn-submit-draft-pr').disabled = !canSubmit;
    el('btn-view-summary').disabled    = !state.prBodyReady;
    el('btn-submit-pr').title      = onBaseBranch ? 'Switch to a feature branch first' : (state.prBodyReady ? '' : 'Generate a PR Body first');
    el('btn-submit-draft-pr').title = onBaseBranch ? 'Switch to a feature branch first' : (state.prBodyReady ? '' : 'Generate a PR Body first');
    el('btn-view-summary').title    = state.prBodyReady ? '' : 'Generate a PR Body first';

    // Update generate button labels to Regenerate once content exists
    el('btn-pr-body-label').textContent   = state.prBodyReady ? '⇄ Regenerate PR Body' : '⇄ Generate PR Body';
    const reviewDone = state.lastRunStatus === 'success' && state.lastRunType === 'prReview';
    el('btn-pr-review-label').textContent = reviewDone ? '✦ Regenerate PR Review' : '✦ Generate PR Review';

    if (state.isRunning) {
      setRunning(true, state.lastRunType === 'prBody' ? 'Generating PR Body...' : 'Generating PR Review...');
    } else {
      setRunning(false, '');
    }

    // Preview view fields
    const isPrBody = state.previewKind === 'prBody';
    el('preview-header-title').textContent = isPrBody ? 'PR Body' : 'PR Review';
    el('btn-preview-copy-title').style.display = isPrBody ? '' : 'none';
    el('btn-preview-submit').style.display = (isPrBody && state.prBodyReady) ? '' : 'none';
    el('btn-preview-draft').style.display = (isPrBody && state.prBodyReady) ? '' : 'none';

    // GitHub-style title bar
    const titleBar = el('gh-pr-title-bar');
    const titleText = el('gh-pr-title-text');
    if (isPrBody && state.previewTitle) {
      titleBar.style.display = 'block';
      titleText.textContent = state.previewTitle;
    } else {
      titleBar.style.display = 'none';
      titleText.textContent = '';
    }

    if (state.previewBody) {
      el('preview-content').innerHTML = state.previewBody;
    } else {
      el('preview-content').innerHTML = '';
    }
  }

  function setRunning(running, msg) {
    allBtns.forEach(b => { if (b) b.disabled = running; });
    const area = el('status-area');
    if (running) {
      el('status-message').textContent = msg;
      area.style.display = 'flex';
    } else {
      area.style.display = 'none';
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'stateUpdate':
        applyState(msg.state);
        break;
      case 'runStart':
        setRunning(true, msg.runType === 'prBody' ? 'Generating PR Body...' : 'Generating PR Review...');
        break;
      case 'runEnd':
        setRunning(false, '');
        const label = msg.runType === 'prBody' ? 'PR Body' : 'PR Review';
        const icon  = msg.success ? '✓' : '✗';
        el('last-run-info').textContent = icon + ' ' + label + ' · ' + msg.timestamp;
        el('last-run-row').style.display = '';
        if (msg.runType === 'prBody' && msg.success) {
          el('btn-submit-pr').disabled = false;
          el('btn-submit-draft-pr').disabled = false;
          el('btn-view-summary').disabled = false;
          el('btn-submit-pr').title = '';
          el('btn-submit-draft-pr').title = '';
          el('btn-view-summary').title = '';
          el('btn-pr-body-label').textContent = '⇄ Regenerate PR Body';
        }
        if (msg.runType === 'prReview' && msg.success) {
          el('btn-pr-review-label').textContent = '✦ Regenerate PR Review';
        }
        break;
    }
  });

  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
    }
}
