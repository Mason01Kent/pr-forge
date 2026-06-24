import * as https from 'https';
import { ScmProvider, PrPayload, PrResult } from './index';

function ghRequest(
    options: https.RequestOptions,
    token: string,
    body?: string
): Promise<{ statusCode: number; json: unknown }> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.headers as Record<string, string> ?? {}),
        };
        if (body) { headers['Content-Length'] = Buffer.byteLength(body).toString(); }

        const req = https.request({ hostname: 'api.github.com', ...options, headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                try {
                    resolve({ statusCode: res.statusCode ?? 0, json: JSON.parse(raw) });
                } catch {
                    reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`));
                }
            });
        });
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitHub API: ${err.message}`)));
        if (body) { req.write(body); }
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
        default:  return '';
    }
}

export class GitHubScmProvider implements ScmProvider {
    readonly name = 'GitHub';
    constructor(private readonly token: string) {}

    async createPr(payload: PrPayload): Promise<PrResult> {
        const { owner, repo, title, body, head, base, draft } = payload;
        const reqBody = JSON.stringify({ title, body, head, base, draft: draft ?? false });
        const { statusCode, json } = await ghRequest(
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; number?: number; message?: string; errors?: Array<{ message?: string; code?: string; field?: string }> };
        if (statusCode === 201 && j.html_url && j.number) {
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
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}`, method: 'PATCH', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; number?: number; message?: string };
        if (statusCode === 200 && j.html_url && j.number) {
            return { url: j.html_url, number: j.number };
        }
        throw new Error((j.message || `GitHub API error ${statusCode}`) + ghHint(statusCode));
    }

    async postPrComment(payload: { owner: string; repo: string; number: number; body: string }): Promise<{ url: string }> {
        const { owner, repo, number, body } = payload;
        const reqBody = JSON.stringify({ body });
        const { statusCode, json } = await ghRequest(
            { path: `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/comments`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            this.token, reqBody
        );
        const j = json as { html_url?: string; message?: string };
        if (statusCode === 201 && j.html_url) {
            return { url: j.html_url };
        }
        throw new Error((j.message || `GitHub API error ${statusCode}`) + ghHint(statusCode));
    }
}

function enc(s: string): string { return encodeURIComponent(s); }
