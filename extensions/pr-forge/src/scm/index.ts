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

export interface ScmProvider {
    /** Human-readable name for error messages. */
    name: string;
    /** Create a new pull/merge request. */
    createPr(payload: PrPayload): Promise<PrResult>;
    /** Find an open PR for the given head branch. Returns null if none exists. */
    findOpenPr(payload: Omit<PrPayload, 'title' | 'body' | 'base' | 'draft'>): Promise<PrResult | null>;
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

/**
 * Parse a git remote URL and return the owner/repo plus the matching ScmProvider.
 * Supports GitHub and GitLab remotes; returns null for all other hosts.
 */
export function parseRemote(remoteUrl: string, token: string): ParsedRemote | null {
    // GitHub HTTPS or SSH
    const ghHttps = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (ghHttps) {
        return { owner: ghHttps[1], repo: ghHttps[2], provider: new GitHubScmProvider(token) };
    }
    const ghSsh = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (ghSsh) {
        return { owner: ghSsh[1], repo: ghSsh[2], provider: new GitHubScmProvider(token) };
    }

    // GitLab HTTPS: https://gitlab.com/owner/repo or https://gitlab.com/group/subgroup/repo
    const glHttps = remoteUrl.match(/^https?:\/\/gitlab\.com\/(.+?)\/([^/\s]+?)(?:\.git)?$/);
    if (glHttps) {
        return { owner: glHttps[1], repo: glHttps[2], provider: new GitLabScmProvider(token) };
    }
    // GitLab SSH: git@gitlab.com:owner/repo or git@gitlab.com:group/subgroup/repo
    const glSsh = remoteUrl.match(/^git@gitlab\.com:(.+?)\/([^/\s]+?)(?:\.git)?$/);
    if (glSsh) {
        return { owner: glSsh[1], repo: glSsh[2], provider: new GitLabScmProvider(token) };
    }

    return null;
}
