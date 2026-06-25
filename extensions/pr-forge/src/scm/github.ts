import * as http from 'http';
import * as https from 'https';
import { ScmProvider, PrPayload, PrResult, ReviewComment } from './index';

function ghRequest(
    baseUrl: string,
    options: https.RequestOptions,
    token: string,
    body?: string
): Promise<{ statusCode: number; json: unknown }> {
    return new Promise((resolve, reject) => {
        const url = new URL(baseUrl + String(options.path ?? ''));
        const mod = url.protocol === 'http:' ? http : https;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.headers as Record<string, string> ?? {}),
        };
        if (body) {
            headers['Content-Length'] = Buffer.byteLength(body).toString();
        }

        const req = mod.request(
            {
                hostname: url.hostname,
                port: url.port || undefined,
                path: url.pathname + url.search,
                method: options.method,
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    try {
                        resolve({ statusCode: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} });
                    } catch {
                        reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`));
                    }
                });
            }
        );
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitHub API: ${err.message}`)));
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/** Map a GitHub API status code to an actionable hint appended to the error. */
function ghHint(statusCode: number): string {
    switch (statusCode) {
        case 401: return ' (Bad credentials — your GitHub token is invalid or expired. Re-authenticate via the Accounts menu or update GITHUB_TOKEN.)';
        case 403: return ' (Forbidden — the token lacks the "repo" scope, or you have hit a rate limit. Re-authorize with repo access.)';
        case 404: return ' (Not found — the repository does not exist or your token cannot access it.)';
        case 422: return ' (Unprocessable — often "no commits between base and head" or a PR already exists for this branch.)';
        default: return '';
    }
}

function enc(s: string): string { return encodeURIComponent(s); }

async function findMilestoneNumber(baseUrl: string, token: string, owner: string, repo: string, milestone: string): Promise<number | null> {
    const { statusCode, json } = await ghRequest(
        baseUrl,
        { path: `/repos/${enc(owner)}/${enc(repo)}/milestones?state=all&per_page=100`, method: 'GET' },
        token
    );
    if (statusCode !== 200 || !Array.isArray(json)) {
        return null;
    }
    const target = milestone.trim().toLowerCase();
    const match = json.find((m: { title?: string; number?: number }) => (m.title ?? '').trim().toLowerCase() === target);
    return match?.number ?? null;
}

async function applyMetadata(baseUrl: string, token: string, owner: string, repo: string, number: number, payload: PrPayload): Promise<void> {
    const labels = payload.labels?.map(s => s.trim()).filter(Boolean) ?? [];
    const assignees = payload.assignees?.map(s => s.trim()).filter(Boolean) ?? [];
    const reviewers = payload.reviewers?.map(s => s.trim()).filter(Boolean) ?? [];
    const milestone = payload.milestone?.trim() ?? '';

    try {
        if (labels.length > 0) {
            await ghRequest(baseUrl, { path: `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/labels`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, token, JSON.stringify({ labels }));
        }
    } catch { /* best effort */ }

    try {
        if (assignees.length > 0) {
            await ghRequest(baseUrl, { path: `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/assignees`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, token, JSON.stringify({ assignees }));
        }
    } catch { /* best effort */ }

    try {
        if (reviewers.length > 0) {
            await ghRequest(baseUrl, { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}/requested_reviewers`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, token, JSON.stringify({ reviewers }));
        }
    } catch { /* best effort */ }

    if (milestone) {
        try {
            const milestoneNumber = await findMilestoneNumber(baseUrl, token, owner, repo, milestone);
            if (milestoneNumber !== null) {
                await ghRequest(baseUrl, { path: `/repos/${enc(owner)}/${enc(repo)}/issues/${number}`, method: 'PATCH', headers: { 'Content-Type': 'application/json' } }, token, JSON.stringify({ milestone: milestoneNumber }));
            }
        } catch { /* best effort */ }
    }
}

export class GitHubScmProvider implements ScmProvider {
    readonly name = 'GitHub';

    constructor(private readonly token: string, private readonly baseUrl = 'https://api.github.com') {}

    async createPr(payload: PrPayload): Promise<PrResult> {
        const { owner, repo, title, body, head, base, draft } = payload;
        const reqBody = JSON.stringify({ title, body, head, base, draft: draft ?? false });
        const { statusCode, json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; number?: number; message?: string; errors?: Array<{ message?: string; code?: string; field?: string }> };
        if (statusCode === 201 && j.html_url && j.number) {
            await applyMetadata(this.baseUrl, this.token, owner, repo, j.number, payload);
            return { url: j.html_url, number: j.number };
        }
        let msg = j.message || `GitHub API error ${statusCode}`;
        if (j.errors?.length) {
            msg += ` — ${j.errors.map(e => e.message || e.code || e.field || JSON.stringify(e)).join('; ')}`;
        }
        throw new Error(msg + ghHint(statusCode));
    }

    async findOpenPr(payload: Omit<PrPayload, 'title' | 'body' | 'base' | 'draft'>): Promise<PrResult | null> {
        const { owner, repo, head } = payload;
        const query = `head=${enc(owner)}%3A${enc(head)}&state=open&per_page=1`;
        const { json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls?${query}`, method: 'GET' },
            this.token
        );
        const arr = json as Array<{ html_url?: string; number?: number }>;
        if (!Array.isArray(arr) || arr.length === 0) { return null; }
        const pr = arr[0];
        return (pr.html_url && pr.number) ? { url: pr.html_url, number: pr.number } : null;
    }

    async updatePr(payload: PrPayload & { number: number }): Promise<PrResult> {
        const { owner, repo, number, title, body } = payload;
        const reqBody = JSON.stringify({ title, body });
        const { statusCode, json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}`, method: 'PATCH', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; number?: number; message?: string };
        if (statusCode === 200 && j.html_url && j.number) {
            await applyMetadata(this.baseUrl, this.token, owner, repo, number, payload);
            return { url: j.html_url, number: j.number };
        }
        throw new Error((j.message || `GitHub API error ${statusCode}`) + ghHint(statusCode));
    }

    async postPrComment(payload: { owner: string; repo: string; number: number; body: string }): Promise<{ url: string }> {
        const { owner, repo, number, body } = payload;
        const reqBody = JSON.stringify({ body });
        const { statusCode, json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/comments`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; message?: string };
        if (statusCode === 201 && j.html_url) {
            return { url: j.html_url };
        }
        throw new Error((j.message || `GitHub API error ${statusCode}`) + ghHint(statusCode));
    }

    async createReview(payload: {
        owner: string; repo: string; number: number; body: string; comments: ReviewComment[];
    }): Promise<{ url: string }> {
        const { owner, repo, number, body, comments } = payload;
        const reqBody = JSON.stringify({ body, event: 'COMMENT', comments });
        const { statusCode, json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}/reviews`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; pull_request_url?: string; message?: string };
        if (statusCode === 200 && (j.html_url || j.pull_request_url)) {
            return { url: j.html_url || j.pull_request_url || '' };
        }
        throw new Error((j.message || `GitHub API error ${statusCode}`) + ghHint(statusCode));
    }
}
