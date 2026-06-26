/**
 * SCM provider abstraction.
 * Supports GitHub and GitLab remotes. Additional providers can be wired into
 * `parseRemote` as needed.
 */

export interface PrPayload {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token: string;
    draft?: boolean;
    labels?: string[];
    reviewers?: string[];
    assignees?: string[];
    milestone?: string;
}

export interface PrResult {
    url: string;
    number: number;
}

export interface ExistingPrSummary extends PrResult {
    title?: string;
    body?: string;
    draft?: boolean;
}

export interface InboxItem {
    number: number;
    title: string;
    url: string;
    state?: string;
    draft?: boolean;
    author?: string;
    updatedAt?: string;
    labels?: string[];
}

export interface IssueItem {
    number: number;
    title: string;
    url: string;
    body?: string;
    state?: string;
    author?: string;
    updatedAt?: string;
    labels?: string[];
}

export interface ReadinessSummary {
    state: 'ready' | 'blocked' | 'unknown';
    summary: string;
    blockers: string[];
    info: string[];
    updatedAt?: string;
}

export interface ReviewThreadComment {
    author?: string;
    body: string;
    url?: string;
    createdAt?: string;
}

export interface ReviewThread {
    id: string;
    title: string;
    url: string;
    path?: string;
    line?: number;
    state: 'resolved' | 'unresolved' | 'unknown';
    actionable: boolean;
    comments: ReviewThreadComment[];
}

export interface ReviewThreadReplyResult {
    url: string;
}

export interface ReviewThreadStateResult {
    state: 'resolved' | 'unresolved';
}

export interface ScmProvider {
    /** Human-readable name for error messages. */
    name: string;
    /** Create a new pull/merge request. */
    createPr(payload: PrPayload): Promise<PrResult>;
    /** Find an open PR for the given head branch. Returns null if none exists. */
    findOpenPr(payload: Omit<PrPayload, 'title' | 'body' | 'base' | 'draft'>): Promise<ExistingPrSummary | null>;
    /** List open PRs or MRs for the current repository. */
    listOpenPrs(payload: { owner: string; repo: string }): Promise<InboxItem[]>;
    /** List open issues for the current repository. */
    listOpenIssues(payload: { owner: string; repo: string }): Promise<IssueItem[]>;
    /** Summarize merge readiness for a specific PR/MR. */
    getReadiness(payload: { owner: string; repo: string; number: number }): Promise<ReadinessSummary>;
    /** Fetch review threads/comments for a specific PR/MR. */
    listReviewThreads(payload: { owner: string; repo: string; number: number }): Promise<ReviewThread[]>;
    /** Reply to an existing review thread/discussion. */
    replyToReviewThread(payload: { owner: string; repo: string; number: number; threadId: string; body: string }): Promise<ReviewThreadReplyResult>;
    /** Mark a review thread/discussion as resolved. */
    resolveReviewThread(payload: { owner: string; repo: string; number: number; threadId: string }): Promise<ReviewThreadStateResult>;
    /** Mark a review thread/discussion as unresolved. */
    reopenReviewThread(payload: { owner: string; repo: string; number: number; threadId: string }): Promise<ReviewThreadStateResult>;
    /** Update title and body of an existing PR. */
    updatePr(payload: PrPayload & { number: number }): Promise<PrResult>;
    /** Post a plain comment on an existing PR/issue. Returns the comment URL. */
    postPrComment(payload: { owner: string; repo: string; number: number; body: string }): Promise<{ url: string }>;
    /** Create a review with line-anchored inline comments. Returns the review URL. */
    createReview(payload: {
        owner: string;
        repo: string;
        number: number;
        body: string;
        comments: ReviewComment[];
    }): Promise<{ url: string }>;
}

/** A single line-anchored inline review comment (GitHub line-based Reviews API). */
export interface ReviewComment {
    path: string;
    line: number;
    oldLine?: number;
    side: 'RIGHT' | 'LEFT';
    body: string;
}

export { GitHubScmProvider } from './github';
export { GitLabScmProvider } from './gitlab';

import { GitHubScmProvider } from './github';
import { GitLabScmProvider } from './gitlab';

export interface ParsedRemote {
    owner: string;
    repo: string;
    provider: ScmProvider;
}

function inferGitHubBaseUrl(host: string): string {
    if (host.toLowerCase() === 'github.com') {
        return 'https://api.github.com';
    }
    return `https://${host}/api/v3`;
}

function inferGitLabBaseUrl(host: string): string {
    return `https://${host}/api/v4`;
}

/**
 * Parse a git remote URL and return the owner/repo plus the matching ScmProvider.
 * Supports GitHub and GitLab remotes; returns null for all other hosts.
 */
export function parseRemote(remoteUrl: string, token: string): ParsedRemote | null {
    const ghHttps = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (ghHttps) {
        const host = ghHttps[1];
        const path = ghHttps[2].replace(/^\/+|\/+$/g, '');
        const parts = path.split('/').filter(Boolean);
        if (parts.length < 2) {
            return null;
        }
        const repo = parts[parts.length - 1];
        const owner = parts.slice(0, -1).join('/');
        if (/gitlab/i.test(host)) {
            return { owner, repo, provider: new GitLabScmProvider(token, inferGitLabBaseUrl(host)) };
        }
        if (/github/i.test(host) || /github\.com$/i.test(host)) {
            return { owner, repo, provider: new GitHubScmProvider(token, inferGitHubBaseUrl(host)) };
        }
    }
    const glSsh = remoteUrl.match(/^git@([^:]+):(.+?)\/([^/\s]+?)(?:\.git)?$/);
    if (glSsh) {
        const host = glSsh[1];
        const owner = glSsh[2];
        const repo = glSsh[3];
        if (/gitlab/i.test(host)) {
            return { owner, repo, provider: new GitLabScmProvider(token, inferGitLabBaseUrl(host)) };
        }
        if (/github/i.test(host) || /github\.com$/i.test(host)) {
            return { owner, repo, provider: new GitHubScmProvider(token, inferGitHubBaseUrl(host)) };
        }
    }

    return null;
}
