import { ScmProvider, PrPayload, PrResult } from './index';

/**
 * GitLab SCM provider — creates Merge Requests via the GitLab REST API.
 * Full implementation is a v0.4.x follow-up; this stub satisfies the interface
 * so the factory can route gitlab.com remotes without crashing.
 */
export class GitLabScmProvider implements ScmProvider {
    readonly name = 'GitLab';
    constructor(private readonly _token: string) {}

    async createPr(_payload: PrPayload): Promise<PrResult> {
        throw new Error('GitLab MR submission is not yet implemented in PR Forge.');
    }

    async findOpenPr(_payload: Omit<PrPayload, 'title' | 'body' | 'base' | 'draft'>): Promise<PrResult | null> {
        return null;
    }

    async updatePr(_payload: PrPayload & { number: number }): Promise<PrResult> {
        throw new Error('GitLab MR update is not yet implemented in PR Forge.');
    }
}
