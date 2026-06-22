import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { renderMarkdown } from './markdownRenderer';

export type PreviewContent =
    | { kind: 'prBody';  title: string; body: string; timestamp: string }
    | { kind: 'prReview'; body: string; timestamp: string };

export class PreviewPanel {
    static readonly viewType = 'masonDevTools.preview';
    private static _instance?: PreviewPanel;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _workspaceFolderPath: string;
    private readonly _outputDirectory: string;
    private _content: PreviewContent;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        content: PreviewContent,
        workspaceFolderPath: string,
        outputDirectory: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._workspaceFolderPath = workspaceFolderPath;
        this._outputDirectory = outputDirectory;
        this._content = content;

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            (msg: { command: string }) => this._handleMessage(msg),
            undefined,
            []
        );

        this._panel.onDidDispose(() => {
            PreviewPanel._instance = undefined;
        });
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        content: PreviewContent,
        workspaceFolderPath: string,
        outputDirectory: string
    ): void {
        if (PreviewPanel._instance) {
            PreviewPanel._instance._panel.reveal(vscode.ViewColumn.Beside);
            PreviewPanel._instance.update(content);
            return;
        }

        const title = content.kind === 'prBody' ? 'PR Body' : 'PR Review';
        const panel = vscode.window.createWebviewPanel(
            'masonDevTools.preview',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        PreviewPanel._instance = new PreviewPanel(panel, extensionUri, content, workspaceFolderPath, outputDirectory);
    }

    public update(content: PreviewContent): void {
        this._content = content;
        const title = content.kind === 'prBody' ? 'PR Body' : 'PR Review';
        this._panel.title = title;
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _handleMessage(msg: { command: string }): void {
        switch (msg.command) {
            case 'copyTitle':
                if (this._content.kind === 'prBody') {
                    vscode.env.clipboard.writeText(this._content.title);
                    vscode.window.showInformationMessage('PR title copied to clipboard');
                }
                break;
            case 'copyBody':
                if (this._content.kind === 'prBody') {
                    vscode.env.clipboard.writeText(this._content.body);
                    vscode.window.showInformationMessage('PR body copied to clipboard');
                }
                break;
            case 'copyReview':
                vscode.env.clipboard.writeText(this._content.body);
                vscode.window.showInformationMessage('Review copied to clipboard');
                break;
            case 'openInEditor': {
                const filename = this._content.kind === 'prBody' ? 'PR_BODY.md' : 'PR_REVIEW.md';
                const filePath = path.join(this._workspaceFolderPath, this._outputDirectory, filename);
                vscode.workspace.openTextDocument(filePath).then((doc) => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
                break;
            }
            case 'submitPr':
                vscode.commands.executeCommand('masonDevTools.submitPr');
                break;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'preview.css')
        );

        const isPrBody = this._content.kind === 'prBody';
        const title = isPrBody ? 'PR Body' : 'PR Review';
        const timestamp = this._content.timestamp;

        // Build toolbar right buttons
        let toolbarRightHtml = '';
        if (isPrBody) {
            toolbarRightHtml = `
                <button class="btn btn-secondary" id="btn-copy-title">Copy Title</button>
                <button class="btn btn-secondary" id="btn-copy-body">Copy Body</button>
                <button class="btn btn-submit-pr" id="btn-submit-pr">Submit PR to GitHub</button>
                <button class="btn btn-secondary" id="btn-open-editor">Open in Editor</button>`;
        } else {
            toolbarRightHtml = `
                <button class="btn btn-secondary" id="btn-copy-review">Copy Review</button>
                <button class="btn btn-secondary" id="btn-open-editor">Open in Editor</button>`;
        }

        // Build content area
        let contentHtml = '';
        if (isPrBody) {
            const prTitle = (this._content as { kind: 'prBody'; title: string }).title;
            const bodyHtml = renderMarkdown(this._content.body);
            contentHtml = `
                <div class="content-section">
                    <div class="section-label">PR Title</div>
                    <pre class="pr-title">${escapeHtml(prTitle)}</pre>
                </div>
                <div class="content-section">
                    <div class="section-label">PR Body</div>
                    <div class="markdown-body">${bodyHtml}</div>
                </div>`;
        } else {
            const bodyHtml = renderMarkdown(this._content.body);
            contentHtml = `
                <div class="content-section">
                    <div class="section-label">Review</div>
                    <div class="markdown-body">${bodyHtml}</div>
                </div>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource};
                 script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="panel-title">${escapeHtml(title)}</span>
      <span class="timestamp">${escapeHtml(timestamp)}</span>
    </div>
    <div class="toolbar-right">
      ${toolbarRightHtml}
    </div>
  </div>

  <div class="content-area">
    ${contentHtml}
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);

  const btnCopyTitle  = el('btn-copy-title');
  const btnCopyBody   = el('btn-copy-body');
  const btnCopyReview = el('btn-copy-review');
  const btnOpenEditor = el('btn-open-editor');
  const btnSubmitPr   = el('btn-submit-pr');

  if (btnCopyTitle)  btnCopyTitle.addEventListener('click',  () => vscode.postMessage({ command: 'copyTitle' }));
  if (btnCopyBody)   btnCopyBody.addEventListener('click',   () => vscode.postMessage({ command: 'copyBody' }));
  if (btnCopyReview) btnCopyReview.addEventListener('click', () => vscode.postMessage({ command: 'copyReview' }));
  if (btnOpenEditor) btnOpenEditor.addEventListener('click', () => vscode.postMessage({ command: 'openInEditor' }));
  if (btnSubmitPr)   btnSubmitPr.addEventListener('click',   () => vscode.postMessage({ command: 'submitPr' }));
</script>
</body>
</html>`;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

