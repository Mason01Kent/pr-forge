/**
 * SCM provider abstraction.
 * Each host (GitHub, GitLab, Bitbucket, Azure DevOps) implements ScmProvider.
 * The factory function `getScmProvider` picks the right impl from a remote URL.
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
 * Returns null if the URL is not a recognised SCM host.
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

    // GitLab HTTPS or SSH
    const glHttps = remoteUrl.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (glHttps) {
        return { owner: glHttps[1], repo: glHttps[2], provider: new GitLabScmProvider(token) };
    }
    const glSsh = remoteUrl.match(/^git@gitlab\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (glSsh) {
        return { owner: glSsh[1], repo: glSsh[2], provider: new GitLabScmProvider(token) };
    }

    return null;
}
