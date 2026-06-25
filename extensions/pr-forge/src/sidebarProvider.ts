import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface SidebarState {
    projectName: string | null;
    configExists: boolean;
    provider: string | null;
    providerKeySet: boolean;
    availableModels: string[];
    currentModel: string | null;
    runTestsOnGenerate: boolean;
    includeRecentCommits: boolean;
    includeCommitSummaries: boolean;
    includeFileWalkthrough: boolean;
    reReviewOnPush: boolean;
    lastRunType: 'prBody' | 'prReview' | null;
    lastRunStatus: 'success' | 'error' | null;
    lastRunTimestamp: string | null;
    titleExists: boolean;
    bodyExists: boolean;
    reviewExists: boolean;
    generatedTitle: string;
    generatedTitleShort: string;
    lastGeneratedAt: string | null;
    isRunning: boolean;
    prBodyReady: boolean;
    prReviewReady: boolean;
    generationStep: string | null;
    generationKind: 'prBody' | 'prReview' | null;
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
    | { command: 'showReview' }
    | { command: 'openPreviewPanel' }
    | { command: 'openReviewPanel' }
    | { command: 'copyPreviewTitle' }
    | { command: 'copyPreviewBody' }
    | { command: 'openPrUrl' }
    | { command: 'postReview' }
    | { command: 'postInlineReview' }
    | { command: 'clearPr' }
    | { command: 'setModel'; model: string }
    | { command: 'setRunTests'; value: boolean }
    | { command: 'setIncludeRecentCommits'; value: boolean }
    | { command: 'setCommitSummaries'; value: boolean }
    | { command: 'setFileWalkthrough'; value: boolean }
    | { command: 'setReReviewOnPush'; value: boolean }
    | { command: 'regenerate'; instruction: string }
    | { command: 'cancel' };

type ExtToWebviewMsg =
    | { type: 'stateUpdate'; state: SidebarState }
    | { type: 'runStart'; runType: 'prBody' | 'prReview' }
    | { type: 'runEnd'; runType: 'prBody' | 'prReview'; success: boolean; timestamp: string }
    | { type: 'stepUpdate'; step: string };

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
    onShowReview: () => void;
    onOpenPreviewPanel: () => void;
    onOpenReviewPanel: () => void;
    onCopyPreviewTitle: (title: string) => void;
    onCopyPreviewBody: () => void;
    onOpenPrUrl: () => void;
    onPostReview: () => void;
    onPostInlineReview: () => void;
    onClearPr: () => void;
    onCancel: () => void;
    onSetModel: (model: string) => void;
    onSetRunTests: (value: boolean) => void;
    onSetIncludeRecentCommits: (value: boolean) => void;
    onSetCommitSummaries: (value: boolean) => void;
    onSetFileWalkthrough: (value: boolean) => void;
    onSetReReviewOnPush: (value: boolean) => void;
    onRegenerate: (instruction: string) => Promise<void>;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'prForge.sidebar';

    private _view?: vscode.WebviewView;
    private _state: SidebarState = {
        projectName: null,
        configExists: false,
        provider: null,
        providerKeySet: false,
        availableModels: [],
        currentModel: null,
        runTestsOnGenerate: true,
        includeRecentCommits: false,
        includeCommitSummaries: false,
        includeFileWalkthrough: false,
        reReviewOnPush: false,
        lastRunType: null,
        lastRunStatus: null,
        lastRunTimestamp: null,
        titleExists: false,
        bodyExists: false,
        reviewExists: false,
        generatedTitle: 'PR Content',
        generatedTitleShort: 'PR Content',
        lastGeneratedAt: null,
        isRunning: false,
        prBodyReady: false,
        prReviewReady: false,
        generationStep: null,
        generationKind: null,
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
                case 'showReview':
                    this._callbacks.onShowReview();
                    break;
                case 'openPreviewPanel':
                    this._callbacks.onOpenPreviewPanel();
                    break;
                case 'openReviewPanel':
                    this._callbacks.onOpenReviewPanel();
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
                case 'postReview':
                    this._callbacks.onPostReview();
                    break;
                case 'postInlineReview':
                    this._callbacks.onPostInlineReview();
                    break;
                case 'clearPr':
                    this._callbacks.onClearPr();
                    break;
                case 'cancel':
                    this._callbacks.onCancel();
                    break;
                case 'setModel':
                    this._callbacks.onSetModel(msg.model);
                    break;
                case 'setRunTests':
                    this._callbacks.onSetRunTests(msg.value);
                    break;
                case 'setIncludeRecentCommits':
                    this._callbacks.onSetIncludeRecentCommits(msg.value);
                    break;
                case 'setCommitSummaries':
                    this._callbacks.onSetCommitSummaries(msg.value);
                    break;
                case 'setFileWalkthrough':
                    this._callbacks.onSetFileWalkthrough(msg.value);
                    break;
                case 'setReReviewOnPush':
                    this._callbacks.onSetReReviewOnPush(msg.value);
                    break;
                case 'regenerate':
                    this._callbacks.onRegenerate(msg.instruction);
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
        this._state.generationKind = runType;
        this._state.generationStep = runType === 'prBody' ? 'Generating PR body...' : 'Generating PR review...';
        this._post({ type: 'runStart', runType });
    }

    public notifyRunEnd(runType: 'prBody' | 'prReview', success: boolean): void {
        this._state.isRunning = false;
        this._state.lastRunStatus = success ? 'success' : 'error';
        this._state.lastRunTimestamp = new Date().toLocaleTimeString();
        if (runType === 'prBody' && success) this._state.prBodyReady = true;
        if (runType === 'prReview' && success) this._state.prReviewReady = true;
        this._state.generationStep = null;
        this._state.generationKind = null;
        this._post({ type: 'runEnd', runType, success, timestamp: this._state.lastRunTimestamp });
    }

    public notifyStep(step: string): void {
        this._state.generationStep = step;
        this._post({ type: 'stepUpdate', step });
    }

    private _post(msg: ExtToWebviewMsg): void {
        void this._view?.webview.postMessage(msg);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.css'));

        const ic = {
            pr: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13 10.05V5.5C13 4.12 11.88 3 10.5 3H8.71L9.85 1.85C10.05 1.66 10.05 1.34 9.85 1.15C9.66 0.95 9.34 0.95 9.15 1.15L7.15 3.15C6.95 3.34 6.95 3.66 7.15 3.85L9.15 5.85C9.34 6.05 9.66 6.05 9.85 5.85C10.05 5.66 10.05 5.34 9.85 5.15L8.71 4H10.5C11.33 4 12 4.67 12 5.5V10.05C10.86 10.28 10 11.29 10 12.5C10 13.88 11.12 15 12.5 15C13.88 15 15 13.88 15 12.5C15 11.29 14.14 10.28 13 10.05ZM12.5 14C11.67 14 11 13.33 11 12.5C11 11.67 11.67 11 12.5 11C13.33 11 14 11.67 14 12.5C14 13.33 13.33 14 12.5 14ZM6 3.5C6 2.12 4.88 1 3.5 1C2.12 1 1 2.12 1 3.5C1 4.71 1.86 5.72 3 5.95V10.051C1.86 10.283 1 11.293 1 12.5C1 13.879 2.122 15 3.5 15C4.878 15 6 13.879 6 12.5C6 11.292 5.14 10.283 4 10.051V5.95C5.14 5.72 6 4.71 6 3.5ZM2 3.5C2 2.67 2.67 2 3.5 2C4.33 2 5 2.67 5 3.5C5 4.33 4.33 5 3.5 5C2.67 5 2 4.33 2 3.5ZM5 12.5C5 13.327 4.327 14 3.5 14C2.673 14 2 13.327 2 12.5C2 11.673 2.673 11 3.5 11C4.327 11 5 11.673 5 12.5Z"/></svg>`,
            body: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.14645 5.85355C9.34171 6.04882 9.65829 6.04882 9.85355 5.85355C10.0488 5.65829 10.0488 5.34171 9.85355 5.14645L8.70711 4H10.5C11.3284 4 12 4.67157 12 5.5V10.05C10.8589 10.2816 10 11.2905 10 12.5C10 13.8807 11.1193 15 12.5 15C13.8807 15 15 13.8807 15 12.5C15 11.2905 14.1411 10.2816 13 10.05V5.5C13 4.11929 11.8807 3 10.5 3H8.70711L9.85355 1.85355C10.0488 1.65829 10.0488 1.34171 9.85355 1.14645C9.65829 0.951184 9.34171 0.951184 9.14645 1.14645L7.14645 3.14645C6.95118 3.34171 6.95118 3.65829 7.14645 3.85355L9.14645 5.85355ZM14 12.5C14 13.3284 13.3284 14 12.5 14C11.6716 14 11 13.3284 11 12.5C11 11.6716 11.6716 11 12.5 11C13.3284 11 14 11.6716 14 12.5ZM6 3.5C6 4.70948 5.14112 5.71836 4 5.94999V10.5C4 11.3284 4.67157 12 5.5 12H7.29289L6.14645 10.8536C5.95118 10.6583 5.95118 10.3417 6.14645 10.1464C6.34171 9.95118 6.65829 9.95118 6.85355 10.1464L8.85355 12.1464C9.04882 12.3417 9.04882 12.6583 8.85355 12.8536L6.85355 14.8536C6.65829 15.0488 6.34171 15.0488 6.14645 14.8536C5.95118 14.6583 5.95118 14.3417 6.14645 14.1464L7.29289 13H5.5C4.11929 13 3 11.8807 3 10.5V5.94999C1.85888 5.71836 1 4.70948 1 3.5C1 2.11929 2.11929 1 3.5 1C4.88071 1 6 2.11929 6 3.5ZM5 3.5C5 2.67157 4.32843 2 3.5 2C2.67157 2 2 2.67157 2 3.5C2 4.32843 2.67157 5 3.5 5C4.32843 5 5 4.32843 5 3.5Z"/></svg>`,
            review: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM4.00746 6.26448L3.15246 5.99948L4.01646 5.71848C4.41071 5.58184 4.76826 5.35637 5.06146 5.05948C5.35281 4.76039 5.57294 4.39943 5.70546 4.00348L5.97046 3.14448L6.25046 4.00648C6.38349 4.40638 6.60809 4.76969 6.90636 5.06744C7.20463 5.36519 7.56833 5.58915 7.96846 5.72148L8.84846 5.99048L7.98746 6.27048C7.58707 6.40272 7.22321 6.62691 6.92505 6.92507C6.62689 7.22324 6.4027 7.58709 6.27046 7.98748L6.00546 8.84448L5.72646 7.98548C5.63026 7.69329 5.48483 7.41968 5.29646 7.17648C5.22699 7.08766 5.15254 7.00286 5.07346 6.92248C4.7738 6.62366 4.4089 6.39842 4.00746 6.26448ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515ZM9.62035 11.0585L9.44235 10.9995L9.62635 10.9355C9.92811 10.8305 10.2018 10.6578 10.4264 10.4305C10.6528 10.2015 10.8238 9.92374 10.9264 9.61848L10.9844 9.44048L11.0434 9.62148C11.1453 9.92819 11.3175 10.2069 11.5461 10.4353C11.7748 10.6638 12.0536 10.8357 12.3604 10.9375L12.5554 11.0005L12.3754 11.0595C12.068 11.1617 11.7888 11.3344 11.5601 11.5637C11.3314 11.7931 11.1596 12.0728 11.0584 12.3805L10.9994 12.5615L10.9414 12.3805C10.84 12.0721 10.6676 11.7919 10.4382 11.5623C10.2088 11.3326 9.92863 11.1601 9.62035 11.0585Z"/></svg>`,
            preview: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.98444 8.62471L2.98346 8.62815C2.91251 8.8948 2.63879 9.05404 2.37202 8.9833C1.94098 8.86907 2.01687 8.37186 2.01687 8.37186L2.03453 8.31047C2.03453 8.31047 2.06063 8.22636 2.08166 8.1653C2.12369 8.04329 2.18795 7.87274 2.27931 7.66977C2.46154 7.26493 2.75443 6.72477 3.19877 6.18295C4.09629 5.08851 5.60509 4 8.00017 4C10.3952 4 11.904 5.08851 12.8016 6.18295C13.2459 6.72477 13.5388 7.26493 13.721 7.66977C13.8124 7.87274 13.8766 8.04329 13.9187 8.1653C13.9397 8.22636 13.9552 8.27541 13.9658 8.31047C13.9711 8.328 13.9752 8.34204 13.9781 8.35236L13.9816 8.365L13.9827 8.36916L13.9832 8.37069L13.9835 8.37186C14.0542 8.63878 13.8952 8.91253 13.6283 8.9833C13.3618 9.05397 13.0885 8.89556 13.0172 8.62937L13.0169 8.62815L13.0159 8.62471L13.0085 8.5997C13.0014 8.57616 12.9898 8.53927 12.9732 8.49095C12.9399 8.39422 12.8866 8.25227 12.8091 8.08023C12.6538 7.73508 12.4041 7.27523 12.0283 6.81706C11.2857 5.9115 10.0445 5 8.00017 5C5.95584 5 4.71464 5.9115 3.97201 6.81706C3.59627 7.27523 3.34655 7.73508 3.19119 8.08023C3.11375 8.25227 3.06047 8.39422 3.02715 8.49095C3.01051 8.53927 2.9989 8.57616 2.99179 8.5997L2.98444 8.62471ZM8.00024 7C6.61953 7 5.50024 8.11929 5.50024 9.5C5.50024 10.8807 6.61953 12 8.00024 12C9.38096 12 10.5002 10.8807 10.5002 9.5C10.5002 8.11929 9.38096 7 8.00024 7ZM6.50024 9.5C6.50024 8.67157 7.17182 8 8.00024 8C8.82867 8 9.50024 8.67157 9.50024 9.5C9.50024 10.3284 8.82867 11 8.00024 11C7.17182 11 6.50024 10.3284 6.50024 9.5Z"/></svg>`,
            submit: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.5 7C9.015 7 7 9.015 7 11.5C7 13.985 9.015 16 11.5 16C13.985 16 16 13.985 16 11.5C16 9.015 13.985 7 11.5 7ZM13.854 11.854C13.659 12.049 13.342 12.049 13.147 11.854L12.001 10.708V14.001C12.001 14.277 11.777 14.501 11.501 14.501C11.225 14.501 11.001 14.277 11.001 14.001V10.708L9.855 11.854C9.66 12.049 9.343 12.049 9.148 11.854C8.953 11.659 8.953 11.342 9.148 11.147L11.148 9.147C11.196 9.099 11.251 9.063 11.31 9.039C11.368 9.015 11.432 9.001 11.498 9.001H11.504C11.571 9.001 11.634 9.015 11.692 9.039C11.75 9.063 11.805 9.099 11.852 9.145L11.855 9.148L13.855 11.148C14.05 11.343 14.05 11.66 13.855 11.855L13.854 11.854ZM4.25 12H6V13H4.25C2.455 13 1 11.545 1 9.75C1 8.029 2.338 6.62 4.03 6.507C4.273 4.53 5.958 3 8 3C9.862 3 11.411 4.278 11.857 6H10.811C10.397 4.838 9.303 4 8 4C6.343 4 5 5.343 5 7C5 7.276 4.776 7.5 4.5 7.5H4.25C3.007 7.5 2 8.507 2 9.75C2 10.993 3.007 12 4.25 12Z"/></svg>`,
            draft: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 3.5C6 2.12 4.88 1 3.5 1C2.12 1 1 2.12 1 3.5C1 4.71 1.86 5.72 3 5.95V10.051C1.86 10.283 1 11.293 1 12.5C1 13.879 2.122 15 3.5 15C4.878 15 6 13.879 6 12.5C6 11.292 5.14 10.283 4 10.051V5.95C5.14 5.72 6 4.71 6 3.5ZM5 12.5C5 13.327 4.327 14 3.5 14C2.673 14 2 13.327 2 12.5C2 11.673 2.673 11 3.5 11C4.327 11 5 11.673 5 12.5ZM3.5 5C2.67 5 2 4.33 2 3.5C2 2.67 2.67 2 3.5 2C4.33 2 5 2.67 5 3.5C5 4.33 4.33 5 3.5 5ZM12.5 10C11.122 10 10 11.121 10 12.5C10 13.879 11.122 15 12.5 15C13.878 15 15 13.879 15 12.5C15 11.121 13.878 10 12.5 10ZM12.5 14C11.673 14 11 13.327 11 12.5C11 11.673 11.673 11 12.5 11C13.327 11 14 11.673 14 12.5C14 13.327 13.327 14 12.5 14ZM11.5 7.5C11.5 6.948 11.948 6.5 12.5 6.5C13.052 6.5 13.5 6.948 13.5 7.5C13.5 8.052 13.052 8.5 12.5 8.5C11.948 8.5 11.5 8.052 11.5 7.5ZM11.5 3.5C11.5 2.948 11.948 2.5 12.5 2.5C13.052 2.5 13.5 2.948 13.5 3.5C13.5 4.052 13.052 4.5 12.5 4.5C11.948 4.5 11.5 4.052 11.5 3.5Z"/></svg>`,
            clear: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14 2H10C10 0.897 9.103 0 8 0C6.897 0 6 0.897 6 2H2C1.724 2 1.5 2.224 1.5 2.5C1.5 2.776 1.724 3 2 3H2.54L3.349 12.708C3.456 13.994 4.55 15 5.84 15H10.159C11.449 15 12.543 13.993 12.65 12.708L13.459 3H13.999C14.275 3 14.499 2.776 14.499 2.5C14.499 2.224 14.275 2 13.999 2H14ZM8 1C8.551 1 9 1.449 9 2H7C7 1.449 7.449 1 8 1ZM11.655 12.625C11.591 13.396 10.934 14 10.16 14H5.841C5.067 14 4.41 13.396 4.346 12.625L3.544 3H12.458L11.656 12.625H11.655ZM7 5.5V11.5C7 11.776 6.776 12 6.5 12C6.224 12 6 11.776 6 11.5V5.5C6 5.224 6.224 5 6.5 5C6.776 5 7 5.224 7 5.5ZM10 5.5V11.5C10 11.776 9.776 12 9.5 12C9.224 12 9 11.776 9 11.5V5.5C9 5.224 9.224 5 9.5 5C9.776 5 10 5.224 10 5.5Z"/></svg>`,
            back: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z"/></svg>`,
            sync: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>`,
            copy: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 5V12.73C2.4 12.38 2 11.74 2 11V5C2 2.79 3.79 1 6 1H9C9.74 1 10.38 1.4 10.73 2H6C4.35 2 3 3.35 3 5ZM11 15H6C4.897 15 4 14.103 4 13V5C4 3.897 4.897 3 6 3H11C12.103 3 13 3.897 13 5V13C13 14.103 12.103 15 11 15ZM12 5C12 4.448 11.552 4 11 4H6C5.448 4 5 4.448 5 5V13C5 13.552 5.448 14 6 14H11C11.552 14 12 13.552 12 13V5Z"/></svg>`,
            openExternal: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M15 9.5V12.5C15 13.879 13.879 15 12.5 15H3.5C2.121 15 1 13.879 1 12.5V3.5C1 2.121 2.121 1 3.5 1H6.5C6.776 1 7 1.224 7 1.5C7 1.776 6.776 2 6.5 2H3.5C2.673 2 2 2.673 2 3.5V12.5C2 13.327 2.673 14 3.5 14H12.5C13.327 14 14 13.327 14 12.5V9.5C14 9.224 14.224 9 14.5 9C14.776 9 15 9.224 15 9.5ZM14.5 1H9.5C9.224 1 9 1.224 9 1.5C9 1.776 9.224 2 9.5 2H13.293L9.147 6.146C8.952 6.341 8.952 6.658 9.147 6.853C9.245 6.951 9.373 6.999 9.501 6.999C9.629 6.999 9.757 6.95 9.855 6.853L14.001 2.707V6.5C14.001 6.776 14.225 7 14.501 7C14.777 7 15.001 6.776 15.001 6.5V1.5C15.001 1.224 14.777 1 14.501 1H14.5Z"/></svg>`,
        };

        return /* html */ `<!DOCTYPE html>
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
<div id="tools-view">
  <div class="header">
    <span class="header-icon">${ic.pr}</span>
    <h2 class="header-title">PR Forge</h2>
  </div>

  <div class="card" id="status-card">
    <div class="card-row"><span class="label">Project</span><span class="value" id="project-name">-</span></div>
    <div class="card-row"><span class="label">Config</span><span class="badge warn" id="config-badge">Not found</span></div>
    <div class="card-row"><span class="label">Provider</span><span class="value" id="provider-name">-</span></div>
    <div class="card-row"><span class="label">API Key</span><span class="badge warn" id="key-badge">Not set</span></div>
    <div class="card-row" id="model-row" style="display:none"><span class="label">Model</span><select class="select-model" id="model-select"></select></div>
    <div class="card-row" id="run-tests-row" style="display:none"><span class="label">Run tests</span><label class="toggle"><input type="checkbox" id="chk-run-tests" checked><span class="toggle-label" id="run-tests-label">On</span></label></div>
    <div class="card-row" id="commit-row" style="display:none"><span class="label">Recent commits</span><label class="toggle"><input type="checkbox" id="chk-commits"><span class="toggle-label" id="commits-label">Off</span></label></div>
    <div class="card-row" id="commit-summary-row" style="display:none"><span class="label">Commit summaries</span><label class="toggle"><input type="checkbox" id="chk-commit-summaries"><span class="toggle-label" id="commit-summaries-label">Off</span></label></div>
    <div class="card-row" id="file-walkthrough-row" style="display:none"><span class="label">File walkthrough</span><label class="toggle"><input type="checkbox" id="chk-file-walkthrough"><span class="toggle-label" id="file-walkthrough-label">Off</span></label></div>
    <div class="card-row" id="rereview-row" style="display:none"><span class="label">Re-review on push</span><label class="toggle"><input type="checkbox" id="chk-rereview"><span class="toggle-label" id="rereview-label">Off</span></label></div>
    <div class="card-row" id="branch-row" style="display:none"><span class="label">Branch</span><span class="value" id="branch-name"></span></div>
    <div class="card-row" id="last-run-row" style="display:none"><span class="label">Last run</span><span class="value" id="last-run-info"></span></div>
    <div class="card-row" id="generated-title-row" style="display:none"><span class="label">Title</span><span class="value gh-pr-title-bar-text" id="generated-title-text"></span></div>
    <div class="card-row" id="submitted-pr-row" style="display:none"><span class="label">Submitted</span><button class="btn-link" id="btn-submitted-pr-link"></button></div>
  </div>

  <div class="section">
    <div class="btn-row">
      <button class="btn btn-ghost" id="btn-set-key">Set API Key</button>
      <button class="btn btn-ghost" id="btn-init-config">Init Config</button>
      <button class="btn btn-ghost" id="btn-open-config">Open Config</button>
    </div>
  </div>

  <div class="section">
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-pr-body">${ic.body}<span id="btn-pr-body-label">Generate PR Body</span></button>
      <button class="btn btn-secondary" id="btn-pr-review">${ic.review}<span id="btn-pr-review-label">Generate PR Review</span></button>
    </div>
  </div>

  <div class="section">
  <button class="btn btn-primary" id="btn-submit-pr" disabled>${ic.submit}<span>Submit PR to GitHub</span></button>
  <button class="btn btn-secondary" id="btn-submit-draft-pr" disabled>${ic.draft}<span>Submit as Draft PR</span></button>
  <button class="btn btn-secondary" id="btn-open-github" style="display:none">${ic.openExternal}<span>Open PR on GitHub</span></button>
  <button class="btn btn-secondary" id="btn-post-review" style="display:none">${ic.review}<span>Post Review to PR</span></button>
  <button class="btn btn-secondary" id="btn-post-inline-review" style="display:none">${ic.review}<span>Post Inline Review</span></button>
  <button class="btn btn-danger" id="btn-clear-pr" style="display:none">${ic.clear}<span>Reset</span></button>
  </div>

  <div class="section generated-content-card" id="generated-content-card" style="display:none">
    <div class="generated-content-summary">
      <span class="generated-content-status" id="generated-content-status"></span>
    </div>
    <div class="btn-row generated-content-actions">
      <button class="btn btn-secondary btn-compact" id="btn-generated-open-body" disabled>${ic.preview}<span>Open Body File</span></button>
      <button class="btn btn-secondary btn-compact" id="btn-generated-open-review" disabled>${ic.review}<span>Open Review File</span></button>
    </div>
    <div class="btn-row generated-content-actions">
      <button class="btn btn-secondary btn-compact" id="btn-generated-preview-body" disabled>${ic.preview}<span>Preview Body</span></button>
      <button class="btn btn-secondary btn-compact" id="btn-generated-preview-review" disabled>${ic.review}<span>Preview Review</span></button>
    </div>
  </div>

  <div class="activity-area" id="activity-area">
    <div class="activity-running" id="activity-running" style="display:none">
      <div class="spinner"></div>
      <span id="activity-step">Running...</span>
    </div>
    <button class="btn btn-secondary" id="btn-activity-cancel" style="display:none">Cancel</button>
    <div class="activity-summary" id="activity-summary" style="display:none">
      <div class="activity-summary-line"><span id="activity-status"></span></div>
    </div>
  </div>
</div>

<div id="preview-view" style="display:none">
  <div class="preview-header">
    <button class="btn-back" id="btn-back">${ic.back}<span>Back</span></button>
    <span class="preview-header-title" id="preview-header-title">PR Body</span>
  </div>
  <div class="preview-actions" id="preview-actions">
    <button class="btn-preview-action" id="btn-preview-copy-title" style="display:none">${ic.copy}<span>Copy Title</span></button>
    <button class="btn-preview-action" id="btn-preview-copy-body">${ic.copy}<span>Copy Body</span></button>
    <button class="btn-preview-action btn-preview-draft" id="btn-preview-draft" style="display:none">${ic.draft}<span>Submit Draft</span></button>
    <button class="btn-preview-action btn-preview-submit" id="btn-preview-submit" style="display:none">${ic.submit}<span>Submit PR</span></button>
  </div>
  <div class="gh-pr-title-bar" id="gh-pr-title-bar" style="display:none">
    <div class="gh-pr-title-bar-label">PR Title</div>
    <div class="gh-pr-title-bar-text" id="gh-pr-title-text"></div>
  </div>
  <div class="preview-content" id="preview-content"></div>
  <div class="regen-bar" id="regen-bar" style="display:none">
    <input class="regen-input" id="regen-input" type="text" placeholder="Instruction - e.g. make the summary shorter...">
    <button class="btn-regen" id="btn-regen">${ic.sync}<span>Regenerate</span></button>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  const toolsView = el('tools-view');
  const previewView = el('preview-view');
  let _onBaseBranch = false;
  let currentState = null;

  const allBtns = ['btn-set-key','btn-init-config','btn-open-config','btn-pr-body','btn-pr-review','btn-submit-pr','btn-submit-draft-pr','btn-open-github','btn-post-review','btn-post-inline-review','btn-clear-pr','btn-generated-open-body','btn-generated-open-review','btn-generated-preview-body','btn-generated-preview-review'].map(el);

  el('btn-set-key').addEventListener('click', () => vscode.postMessage({ command: 'setApiKey' }));
  el('btn-init-config').addEventListener('click', () => vscode.postMessage({ command: 'initConfig' }));
  el('btn-open-config').addEventListener('click', () => vscode.postMessage({ command: 'openConfig' }));
  el('btn-pr-body').addEventListener('click', () => vscode.postMessage({ command: 'generatePrBody' }));
  el('btn-pr-review').addEventListener('click', () => vscode.postMessage({ command: 'generatePrReview' }));
  el('btn-submit-pr').addEventListener('click', () => vscode.postMessage({ command: 'submitPr' }));
  el('btn-submit-draft-pr').addEventListener('click', () => vscode.postMessage({ command: 'submitDraftPr' }));
  el('btn-generated-open-body').addEventListener('click', () => vscode.postMessage({ command: 'showPreview' }));
  el('btn-generated-open-review').addEventListener('click', () => vscode.postMessage({ command: 'showReview' }));
  el('btn-generated-preview-body').addEventListener('click', () => vscode.postMessage({ command: 'openPreviewPanel' }));
  el('btn-generated-preview-review').addEventListener('click', () => vscode.postMessage({ command: 'openReviewPanel' }));
  el('btn-submitted-pr-link').addEventListener('click', () => vscode.postMessage({ command: 'openPrUrl' }));
  el('btn-open-github').addEventListener('click', () => vscode.postMessage({ command: 'openPrUrl' }));
  el('btn-post-review').addEventListener('click', () => vscode.postMessage({ command: 'postReview' }));
  el('btn-post-inline-review').addEventListener('click', () => vscode.postMessage({ command: 'postInlineReview' }));
  el('btn-clear-pr').addEventListener('click', () => vscode.postMessage({ command: 'clearPr' }));
  el('btn-activity-cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
  el('model-select').addEventListener('change', (e) => vscode.postMessage({ command: 'setModel', model: e.target.value }));
  el('chk-run-tests').addEventListener('change', (e) => {
    el('run-tests-label').textContent = e.target.checked ? 'On' : 'Off';
    vscode.postMessage({ command: 'setRunTests', value: e.target.checked });
  });
  el('chk-commits').addEventListener('change', (e) => {
    el('commits-label').textContent = e.target.checked ? 'On' : 'Off';
    vscode.postMessage({ command: 'setIncludeRecentCommits', value: e.target.checked });
  });
  el('chk-commit-summaries').addEventListener('change', (e) => {
    el('commit-summaries-label').textContent = e.target.checked ? 'On' : 'Off';
    vscode.postMessage({ command: 'setCommitSummaries', value: e.target.checked });
  });
  el('chk-file-walkthrough').addEventListener('change', (e) => {
    el('file-walkthrough-label').textContent = e.target.checked ? 'On' : 'Off';
    vscode.postMessage({ command: 'setFileWalkthrough', value: e.target.checked });
  });
  el('chk-rereview').addEventListener('change', (e) => {
    el('rereview-label').textContent = e.target.checked ? 'On' : 'Off';
    vscode.postMessage({ command: 'setReReviewOnPush', value: e.target.checked });
  });

  el('btn-back').addEventListener('click', () => vscode.postMessage({ command: 'showTools' }));
  el('btn-preview-copy-title').addEventListener('click', () => vscode.postMessage({ command: 'copyPreviewTitle' }));
  el('btn-preview-copy-body').addEventListener('click', () => vscode.postMessage({ command: 'copyPreviewBody' }));
  el('btn-preview-submit').addEventListener('click', () => vscode.postMessage({ command: 'submitPr' }));
  el('btn-preview-draft').addEventListener('click', () => vscode.postMessage({ command: 'submitDraftPr' }));
  el('btn-regen').addEventListener('click', () => {
    const instruction = el('regen-input').value.trim();
    if (!instruction) return;
    el('regen-input').value = '';
    vscode.postMessage({ command: 'regenerate', instruction });
  });
  el('regen-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('btn-regen').click();
  });

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

  function updateActivity(state) {
    const area = el('activity-area');
    const running = el('activity-running');
    const summary = el('activity-summary');
    const cancel = el('btn-activity-cancel');
    const step = el('activity-step');
    const status = el('activity-status');

    const hasSuccess = !state.isRunning && state.lastRunStatus === 'success' && (state.bodyExists || state.reviewExists);
    const hasError = !state.isRunning && state.lastRunStatus === 'error';
    const show = state.isRunning || hasSuccess || hasError;

    area.classList.toggle('show', show);
    running.style.display = state.isRunning ? 'flex' : 'none';
    cancel.style.display = state.isRunning ? '' : 'none';
    summary.style.display = !state.isRunning && (hasSuccess || hasError) ? 'flex' : 'none';

    if (state.isRunning) {
      step.textContent = state.generationStep || (state.generationKind === 'prReview' ? 'Generating PR review...' : 'Generating PR body...');
      return;
    }

    if (hasSuccess) {
      status.textContent = '✓ ' + (state.lastRunTimestamp || state.lastGeneratedAt || '');
      return;
    }

    if (hasError) {
      status.textContent = '✕ Generation failed';
      return;
    }

    status.textContent = '';
  }

  function applyState(state) {
    currentState = state;
    switchView(state.viewMode || 'tools');
    el('project-name').textContent = state.projectName || '-';

    const badge = el('config-badge');
    if (state.configExists) {
      badge.textContent = 'Found ✓';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Not found';
      badge.className = 'badge warn';
    }

    el('provider-name').textContent = state.provider ? state.provider.charAt(0).toUpperCase() + state.provider.slice(1) : '-';
    const keyBadge = el('key-badge');
    const noAuth = state.provider === 'ollama';
    keyBadge.textContent = noAuth ? 'Not needed' : (state.providerKeySet ? 'Set ✓' : 'Not set');
    keyBadge.className = (noAuth || state.providerKeySet) ? 'badge ok' : 'badge warn';

    if (state.availableModels && state.availableModels.length > 0) {
      const sel = el('model-select');
      const prev = sel.value;
      sel.innerHTML = state.availableModels.map(m => '<option value="' + m + '"' + (m === state.currentModel ? ' selected' : '') + '>' + m + '</option>').join('');
      if (state.currentModel) sel.value = state.currentModel;
      else if (prev) sel.value = prev;
      el('model-row').style.display = '';
    } else {
      el('model-row').style.display = 'none';
    }

    if (state.configExists) {
      el('chk-run-tests').checked = state.runTestsOnGenerate !== false;
      el('run-tests-label').textContent = state.runTestsOnGenerate !== false ? 'On' : 'Off';
      el('run-tests-row').style.display = '';
      el('chk-commits').checked = state.includeRecentCommits === true;
      el('commits-label').textContent = state.includeRecentCommits === true ? 'On' : 'Off';
      el('commit-row').style.display = '';
      el('chk-commit-summaries').checked = state.includeCommitSummaries === true;
      el('commit-summaries-label').textContent = state.includeCommitSummaries === true ? 'On' : 'Off';
      el('commit-summary-row').style.display = '';
      el('chk-file-walkthrough').checked = state.includeFileWalkthrough === true;
      el('file-walkthrough-label').textContent = state.includeFileWalkthrough === true ? 'On' : 'Off';
      el('file-walkthrough-row').style.display = '';
      el('chk-rereview').checked = state.reReviewOnPush === true;
      el('rereview-label').textContent = state.reReviewOnPush === true ? 'On' : 'Off';
      el('rereview-row').style.display = '';
    } else {
      el('run-tests-row').style.display = 'none';
      el('commit-row').style.display = 'none';
      el('commit-summary-row').style.display = 'none';
      el('file-walkthrough-row').style.display = 'none';
      el('rereview-row').style.display = 'none';
    }

    if (state.lastGeneratedAt || state.lastRunTimestamp) {
      const ts = state.lastGeneratedAt || state.lastRunTimestamp;
      el('last-run-info').textContent = ts;
      el('last-run-row').style.display = '';
    } else {
      el('last-run-row').style.display = 'none';
    }

    if (state.titleExists || state.bodyExists || state.reviewExists) {
      const titleText = state.generatedTitleShort || state.generatedTitle || 'PR Content';
      const titleEl = el('generated-title-text');
      titleEl.textContent = titleText;
      titleEl.title = state.generatedTitle || 'PR Content';
      el('generated-title-row').style.display = '';
    } else {
      el('generated-title-row').style.display = 'none';
    }

    if (state.submittedPrNumber && state.submittedPrTimestamp) {
      const draftTag = state.submittedPrDraft ? ' (Draft)' : '';
      el('btn-submitted-pr-link').textContent = '↗ PR #' + state.submittedPrNumber + draftTag + ' · ' + state.submittedPrTimestamp;
      el('submitted-pr-row').style.display = '';
    } else {
      el('submitted-pr-row').style.display = 'none';
    }

    _onBaseBranch = state.currentBranch !== null && state.currentBranch === state.baseBranch;
    if (state.currentBranch) {
      const branchEl = el('branch-name');
      branchEl.textContent = state.currentBranch;
      branchEl.className = 'value' + (_onBaseBranch ? ' branch-warn' : '');
      el('branch-row').style.display = '';
    } else {
      el('branch-row').style.display = 'none';
    }

    el('btn-pr-body-label').textContent = state.bodyExists ? 'Regenerate PR Body' : 'Generate PR Body';
    el('btn-pr-review-label').textContent = state.reviewExists ? 'Regenerate PR Review' : 'Generate PR Review';
    el('btn-pr-body').title = state.bodyExists ? 'Regenerate the PR body from the current workspace.' : 'Generate the PR body from the current workspace.';
    el('btn-pr-review').title = state.reviewExists ? 'Regenerate the PR review from the current workspace.' : 'Generate the PR review from the current workspace.';

    allBtns.forEach(b => { if (b) b.disabled = !!state.isRunning; });
    el('btn-regen').disabled = !!state.isRunning;

    const canSubmit = state.bodyExists && !_onBaseBranch;
    el('btn-pr-body').disabled = !!state.isRunning || _onBaseBranch;
    el('btn-pr-review').disabled = !!state.isRunning || _onBaseBranch;
    el('btn-pr-body').title = _onBaseBranch ? 'Switch to a feature branch first' : 'Generates the PR title and description to paste into GitHub when opening a pull request.';
    el('btn-pr-review').title = _onBaseBranch ? 'Switch to a feature branch first' : 'Generates the PR body and a code review of your diff.';
    el('btn-submit-pr').disabled = !canSubmit || !!state.isRunning;
    el('btn-submit-draft-pr').disabled = !canSubmit || !!state.isRunning;
    el('btn-submit-pr').title = _onBaseBranch ? 'Switch to a feature branch first' : (state.bodyExists ? '' : 'Generate a PR Body first');
    el('btn-submit-draft-pr').title = _onBaseBranch ? 'Switch to a feature branch first' : (state.bodyExists ? '' : 'Generate a PR Body first');
    el('btn-clear-pr').style.display = state.bodyExists || state.reviewExists || state.lastRunStatus === 'error' ? '' : 'none';
    el('btn-open-github').style.display = state.submittedPrUrl ? '' : 'none';
    el('btn-post-review').style.display = state.reviewExists && state.submittedPrUrl ? '' : 'none';
    el('btn-post-review').title = 'Post the generated review as a comment on the submitted PR';
    el('btn-post-inline-review').style.display = state.submittedPrUrl ? '' : 'none';
    el('btn-post-inline-review').title = 'Generate and post line-anchored inline review comments on the submitted PR';

    const hasGeneratedContent = state.bodyExists || state.reviewExists;
    const generatedCard = el('generated-content-card');
    generatedCard.style.display = hasGeneratedContent ? 'flex' : 'none';
    const generatedStatus = el('generated-content-status');
    generatedStatus.textContent = hasGeneratedContent
      ? '✓ ' + (state.generatedTitleShort || state.generatedTitle || 'PR Content') + ' · ' + (state.lastGeneratedAt || state.lastRunTimestamp || '')
      : '';
    el('btn-generated-open-body').style.display = state.bodyExists ? '' : 'none';
    el('btn-generated-open-review').style.display = state.reviewExists ? '' : 'none';
    el('btn-generated-preview-body').style.display = state.bodyExists ? '' : 'none';
    el('btn-generated-preview-review').style.display = state.reviewExists ? '' : 'none';
    el('btn-generated-open-body').disabled = !state.bodyExists || !!state.isRunning;
    el('btn-generated-open-review').disabled = !state.reviewExists || !!state.isRunning;
    el('btn-generated-preview-body').disabled = !state.bodyExists || !!state.isRunning;
    el('btn-generated-preview-review').disabled = !state.reviewExists || !!state.isRunning;
    el('btn-generated-open-body').title = state.bodyExists ? 'Open the PR body file' : 'Generate a PR Body first';
    el('btn-generated-open-review').title = state.reviewExists ? 'Open the PR review file' : 'Generate a PR Review first';
    el('btn-generated-preview-body').title = state.bodyExists ? 'Preview the PR body' : 'Generate a PR Body first';
    el('btn-generated-preview-review').title = state.reviewExists ? 'Preview the PR review' : 'Generate a PR Review first';

    const isPrBody = state.previewKind === 'prBody';
    el('preview-header-title').textContent = isPrBody ? 'PR Body' : 'PR Review';
    el('btn-preview-copy-title').style.display = isPrBody ? '' : 'none';
    el('btn-preview-submit').style.display = isPrBody && state.prBodyReady ? '' : 'none';
    el('btn-preview-draft').style.display = isPrBody && state.prBodyReady ? '' : 'none';
    el('regen-bar').style.display = isPrBody ? '' : 'none';

    const titleBar = el('gh-pr-title-bar');
    const titleText = el('gh-pr-title-text');
    if (isPrBody && state.previewTitle) {
      titleBar.style.display = 'block';
      titleText.textContent = state.previewTitle;
      titleText.title = state.previewTitle;
    } else {
      titleBar.style.display = 'none';
      titleText.textContent = '';
      titleText.title = '';
    }

    if (state.previewBody !== null && state.previewBody !== undefined) {
      el('preview-content').innerHTML = state.previewBody;
    }

    updateActivity(state);
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'stateUpdate':
        applyState(msg.state);
        break;
      case 'runStart':
        if (currentState) {
          applyState({ ...currentState, isRunning: true, generationKind: msg.runType });
        }
        break;
      case 'stepUpdate':
        if (currentState) {
          applyState({ ...currentState, generationStep: msg.step, isRunning: true });
        }
        break;
      case 'runEnd':
        if (currentState) {
          applyState({ ...currentState, isRunning: false, generationStep: null, generationKind: null });
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
