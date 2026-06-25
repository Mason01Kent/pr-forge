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
            'Accept': 'application/json',
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
        case 401: return ' (Bad credentials — check your GitLab personal access token; api scope required)';
        case 403: return ' (Forbidden — token lacks api scope or you hit a rate limit)';
        case 404: return ' (Not found — project does not exist or token cannot access it)';
        case 422: return ' (Unprocessable — no commits between source and target branch, or MR already exists)';
        default: return '';
    }
}

function projectId(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
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
        const reqBody = JSON.stringify({
            title,
            description: body,
            source_branch: head,
            target_branch: base,
        });
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
        const reqBody = JSON.stringify({ title, description: body });
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

    async createReview(_payload: { owner: string; repo: string; number: number; body: string; comments: ReviewComment[] }): Promise<{ url: string }> {
        throw new Error('GitLab inline review not yet implemented (Slice 4).');
    }
}
