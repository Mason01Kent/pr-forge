/**
 * SCM provider abstraction.
 * PR Forge 1.0 supports GitHub only. `GitLabScmProvider` is kept in the repo
 * (src/scm/gitlab.ts) for a future release but is intentionally not wired into
 * `parseRemote`, so non-GitHub remotes are rejected with a clear message.
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
}

export { GitHubScmProvider } from './github';
// GitLabScmProvider is intentionally NOT re-exported or wired — GitHub-only in 1.0.

import { GitHubScmProvider } from './github';

export interface ParsedRemote {
    owner: string;
    repo: string;
    provider: ScmProvider;
}

/**
 * Parse a git remote URL and return the owner/repo plus the matching ScmProvider.
 * GitHub-only in 1.0 — returns null for any non-GitHub host (including GitLab).
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

    return null;
}
