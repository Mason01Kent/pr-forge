import * as https from 'https';
import * as http from 'http';
import { ScmProvider, PrPayload, PrResult, ReviewComment } from './index';

function glRequest(
    baseUrl: string,
    token: string,
    path: string,
    method: string,
    body?: string
): Promise<{ statusCode: number; json: unknown }> {
    return new Promise((resolve, reject) => {
        const url = new URL(baseUrl + path);
        const mod = url.protocol === 'http:' ? http : https;
        const headers: Record<string, string> = {
            'PRIVATE-TOKEN': token,
            Accept: 'application/json',
            'User-Agent': 'pr-forge-vscode',
        };
        if (body) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body).toString();
        }
        const req = mod.request(
            { hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method, headers },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    try {
                        resolve({ statusCode: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} });
                    } catch {
                        reject(new Error(`GitLab API returned invalid JSON (status ${res.statusCode})`));
                    }
                });
            }
        );
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitLab API: ${err.message}`)));
        if (body) { req.write(body); }
        req.end();
    });
}

function glHint(statusCode: number): string {
    switch (statusCode) {
        case 401: return ' (Bad credentials - check your GitLab personal access token; api scope required)';
        case 403: return ' (Forbidden - token lacks api scope or you hit a rate limit)';
        case 404: return ' (Not found - project does not exist or token cannot access it)';
        case 422: return ' (Unprocessable - no commits between source and target branch, or MR already exists)';
        default: return '';
    }
}

function projectId(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
}

type MergeRequestVersion = {
    base_commit_sha?: string;
    head_commit_sha?: string;
    start_commit_sha?: string;
};

async function resolveGitLabUserIds(baseUrl: string, token: string, usernames: string[]): Promise<number[]> {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const username of usernames.map(u => u.trim()).filter(Boolean)) {
        let resolved: Array<{ id?: number; username?: string }> = [];
        try {
            const exact = await glRequest(baseUrl, token, `/users?username=${encodeURIComponent(username)}`, 'GET');
            if (Array.isArray(exact.json)) {
                resolved = exact.json as Array<{ id?: number; username?: string }>;
            }
        } catch {
            // fall through to fuzzy search
        }
        if (resolved.length === 0) {
            try {
                const fuzzy = await glRequest(baseUrl, token, `/users?search=${encodeURIComponent(username)}`, 'GET');
                if (Array.isArray(fuzzy.json)) {
                    resolved = fuzzy.json as Array<{ id?: number; username?: string }>;
                }
            } catch {
                // skip
            }
        }
        const match = resolved.find(u => (u.username ?? '').toLowerCase() === username.toLowerCase());
        if (match?.id && !seen.has(match.id)) {
            seen.add(match.id);
            ids.push(match.id);
        }
    }
    return ids;
}

async function fetchLatestMergeRequestVersion(
    baseUrl: string,
    token: string,
    pid: string,
    number: number,
): Promise<MergeRequestVersion | null> {
    try {
        const { json } = await glRequest(baseUrl, token, `/projects/${pid}/merge_requests/${number}/versions`, 'GET');
        if (Array.isArray(json) && json.length > 0) {
            const version = json[0] as MergeRequestVersion;
            if (version.base_commit_sha && version.head_commit_sha && version.start_commit_sha) {
                return version;
            }
        }
    } catch {
        // Fall back to note-based comments when version lookup fails.
    }
    return null;
}

function buildDiscussionPayload(comment: ReviewComment, version: MergeRequestVersion): Record<string, unknown> | null {
    const line = Math.round(comment.line);
    const position: Record<string, unknown> = {
        position_type: 'text',
        base_sha: version.base_commit_sha,
        head_sha: version.head_commit_sha,
        start_sha: version.start_commit_sha,
        new_path: comment.path,
        old_path: comment.path,
    };

    if (comment.side === 'LEFT') {
        position.old_line = line;
    } else {
        position.new_line = line;
        if (typeof comment.oldLine === 'number') {
            position.old_line = Math.round(comment.oldLine);
        }
    }

    if (!position.base_sha || !position.head_sha || !position.start_sha) {
        return null;
    }
    return { body: comment.body, position };
}

export class GitLabScmProvider implements ScmProvider {
    readonly name = 'GitLab';
    private readonly baseUrl: string;

    constructor(private readonly token: string, baseUrl?: string) {
        this.baseUrl = baseUrl ?? 'https://gitlab.com/api/v4';
    }

    async createPr(payload: PrPayload): Promise<PrResult> {
        const { owner, repo, title, body, head, base } = payload;
        const pid = projectId(owner, repo);
        const reqPayload: Record<string, unknown> = {
            title,
            description: body,
            source_branch: head,
            target_branch: base,
        };
        const labels = payload.labels?.map(s => s.trim()).filter(Boolean) ?? [];
        const assignees = await resolveGitLabUserIds(this.baseUrl, this.token, payload.assignees ?? []);
        const reviewers = await resolveGitLabUserIds(this.baseUrl, this.token, payload.reviewers ?? []);
        const milestone = payload.milestone?.trim() ?? '';
        if (labels.length > 0) { reqPayload.labels = labels.join(','); }
        if (assignees.length > 0) { reqPayload.assignee_ids = assignees; }
        if (reviewers.length > 0) { reqPayload.reviewer_ids = reviewers; }
        if (milestone) { reqPayload.milestone = milestone; }
        const reqBody = JSON.stringify(reqPayload);
        const { statusCode, json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests`, 'POST', reqBody);
        const j = json as { iid?: number; web_url?: string; message?: string };
        if ((statusCode === 200 || statusCode === 201) && j.iid && j.web_url) {
            return { url: j.web_url, number: j.iid };
        }
        const msg = Array.isArray(j.message) ? (j.message as string[]).join('; ') : (j.message ?? `GitLab API error ${statusCode}`);
        throw new Error(msg + glHint(statusCode));
    }

    async findOpenPr(payload: Omit<PrPayload, 'title' | 'body' | 'base' | 'draft'>): Promise<PrResult | null> {
        const { owner, repo, head } = payload;
        const pid = projectId(owner, repo);
        const query = `state=opened&source_branch=${encodeURIComponent(head)}&per_page=1`;
        const { json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests?${query}`, 'GET');
        const arr = json as Array<{ iid?: number; web_url?: string }>;
        if (!Array.isArray(arr) || arr.length === 0) { return null; }
        const mr = arr[0];
        return (mr.iid && mr.web_url) ? { url: mr.web_url, number: mr.iid } : null;
    }

    async updatePr(payload: PrPayload & { number: number }): Promise<PrResult> {
        const { owner, repo, title, body, number } = payload;
        const pid = projectId(owner, repo);
        const reqPayload: Record<string, unknown> = { title, description: body };
        const labels = payload.labels?.map(s => s.trim()).filter(Boolean) ?? [];
        const assignees = await resolveGitLabUserIds(this.baseUrl, this.token, payload.assignees ?? []);
        const reviewers = await resolveGitLabUserIds(this.baseUrl, this.token, payload.reviewers ?? []);
        const milestone = payload.milestone?.trim() ?? '';
        if (labels.length > 0) { reqPayload.labels = labels.join(','); }
        if (assignees.length > 0) { reqPayload.assignee_ids = assignees; }
        if (reviewers.length > 0) { reqPayload.reviewer_ids = reviewers; }
        if (milestone) { reqPayload.milestone = milestone; }
        const reqBody = JSON.stringify(reqPayload);
        const { statusCode, json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests/${number}`, 'PUT', reqBody);
        const j = json as { iid?: number; web_url?: string; message?: string };
        if (statusCode === 200 && j.iid && j.web_url) {
            return { url: j.web_url, number: j.iid };
        }
        throw new Error((j.message ?? `GitLab API error ${statusCode}`) + glHint(statusCode));
    }

    async postPrComment(payload: { owner: string; repo: string; number: number; body: string }): Promise<{ url: string }> {
        const { owner, repo, number, body } = payload;
        const pid = projectId(owner, repo);
        const reqBody = JSON.stringify({ body });
        const { statusCode, json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests/${number}/notes`, 'POST', reqBody);
        const j = json as { id?: number; noteable_iid?: number; message?: string };
        if ((statusCode === 200 || statusCode === 201) && j.id) {
            const url = `${this.baseUrl.replace('/api/v4', '')}/${owner}/${repo}/-/merge_requests/${number}#note_${j.id}`;
            return { url };
        }
        throw new Error((j.message ?? `GitLab API error ${statusCode}`) + glHint(statusCode));
    }

    async createReview(payload: { owner: string; repo: string; number: number; body: string; comments: ReviewComment[] }): Promise<{ url: string }> {
        const { owner, repo, number, body, comments } = payload;
        const pid = projectId(owner, repo);
        const summaryResult = await this.postPrComment({ owner, repo, number, body });
        const version = await fetchLatestMergeRequestVersion(this.baseUrl, this.token, pid, number);

        for (const c of comments) {
            const discussionPayload = version ? buildDiscussionPayload(c, version) : null;
            if (discussionPayload) {
                try {
                    const { statusCode } = await glRequest(
                        this.baseUrl,
                        this.token,
                        `/projects/${pid}/merge_requests/${number}/discussions`,
                        'POST',
                        JSON.stringify(discussionPayload),
                    );
                    if (statusCode === 200 || statusCode === 201) {
                        continue;
                    }
                } catch {
                    // Use the note fallback below.
                }
            }

            const noteBody = `\`${c.path}:${c.line}\` - ${c.body}`;
            await this.postPrComment({ owner, repo, number, body: noteBody }).catch((err: unknown) => {
                throw new Error(`Failed to post GitLab review comment for ${c.path}:${c.line}: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        return summaryResult;
    }
}
