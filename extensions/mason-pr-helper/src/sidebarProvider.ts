import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface SidebarState {
    projectName: string | null;
    configExists: boolean;
    lastRunType: 'prBody' | 'prReview' | null;
    lastRunStatus: 'success' | 'error' | null;
    lastRunTimestamp: string | null;
    isRunning: boolean;
}

type WebviewToExtMsg =
    | { command: 'initConfig' }
    | { command: 'openConfig' }
    | { command: 'generatePrBody' }
    | { command: 'generatePrReview' }
    | { command: 'submitPr' }
    | { command: 'ready' };

type ExtToWebviewMsg =
    | { type: 'stateUpdate'; state: SidebarState }
    | { type: 'runStart'; runType: 'prBody' | 'prReview' }
    | { type: 'runEnd'; runType: 'prBody' | 'prReview'; success: boolean; timestamp: string };

export interface SidebarCallbacks {
    onInitConfig: () => Promise<void>;
    onOpenConfig: () => Promise<void>;
    onGeneratePrBody: () => Promise<void>;
    onGeneratePrReview: () => Promise<void>;
    onSubmitPr: () => Promise<void>;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'masonDevTools.sidebar';

    private _view?: vscode.WebviewView;
    private _state: SidebarState = {
        projectName: null,
        configExists: false,
        lastRunType: null,
        lastRunStatus: null,
        lastRunTimestamp: null,
        isRunning: false,
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
            }
        });
    }

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
  <title>Mason PR Helper</title>
</head>
<body>

  <div class="header">
    <span class="header-icon">⬡</span>
    <h2 class="header-title">Mason PR Helper</h2>
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
    <div class="card-row" id="last-run-row" style="display:none">
      <span class="label">Last run</span>
      <span class="value" id="last-run-info"></span>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-secondary" id="btn-init-config">⚙ Init Config</button>
    <button class="btn btn-secondary" id="btn-open-config">✎ Open Config</button>
    <hr class="divider">
    <button class="btn btn-primary" id="btn-pr-body">
      <span id="btn-pr-body-label">⇄ Generate PR Body</span>
    </button>
    <button class="btn btn-primary" id="btn-pr-review">
      <span id="btn-pr-review-label">✦ Generate PR Review</span>
    </button>
    <button class="btn btn-submit" id="btn-submit-pr" style="display:none">↑ Submit PR to GitHub</button>
  </div>

  <div class="status-area" id="status-area" style="display:none">
    <div class="spinner"></div>
    <span id="status-message">Running...</span>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const el = (id) => document.getElementById(id);
  const allBtns = ['btn-init-config','btn-open-config','btn-pr-body','btn-pr-review','btn-submit-pr'].map(el);

  el('btn-init-config').addEventListener('click', () => vscode.postMessage({ command: 'initConfig' }));
  el('btn-open-config').addEventListener('click', () => vscode.postMessage({ command: 'openConfig' }));
  el('btn-pr-body').addEventListener('click',     () => vscode.postMessage({ command: 'generatePrBody' }));
  el('btn-pr-review').addEventListener('click',   () => vscode.postMessage({ command: 'generatePrReview' }));
  el('btn-submit-pr').addEventListener('click',   () => vscode.postMessage({ command: 'submitPr' }));

  function applyState(state) {
    el('project-name').textContent = state.projectName || '—';

    const badge = el('config-badge');
    if (state.configExists) {
      badge.textContent = 'Found ✓';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Not found';
      badge.className = 'badge warn';
    }

    if (state.lastRunTimestamp) {
      const label = state.lastRunType === 'prBody' ? 'PR Body' : 'PR Review';
      const icon  = state.lastRunStatus === 'success' ? '✓' : '✗';
      el('last-run-info').textContent = icon + ' ' + label + ' · ' + state.lastRunTimestamp;
      el('last-run-row').style.display = '';
    }

    if (state.isRunning) {
      setRunning(true, state.lastRunType === 'prBody' ? 'Generating PR Body...' : 'Generating PR Review...');
    } else {
      setRunning(false, '');
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
          el('btn-submit-pr').style.display = '';
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
