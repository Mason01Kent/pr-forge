import * as http from 'http';
import * as https from 'https';
import { ScmProvider, PrPayload, PrResult, ReviewComment, InboxItem, ReadinessSummary, ReviewThread } from './index';

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

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function ghGraphqlEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    if (/\/api\/v3$/i.test(trimmed)) {
        return `${trimmed.replace(/\/api\/v3$/i, '/api')}/graphql`;
    }
    return `${trimmed}/graphql`;
}

function ghGraphqlRequest(
    baseUrl: string,
    token: string,
    query: string,
    variables: Record<string, unknown>,
): Promise<{ statusCode: number; json: unknown }> {
    return new Promise((resolve, reject) => {
        const url = new URL(ghGraphqlEndpoint(baseUrl));
        const mod = url.protocol === 'http:' ? http : https;
        const body = JSON.stringify({ query, variables });
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'pr-forge-vscode',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        headers['Content-Length'] = Buffer.byteLength(body).toString();

        const req = mod.request(
            {
                hostname: url.hostname,
                port: url.port || undefined,
                path: url.pathname + url.search,
                method: 'POST',
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
                        reject(new Error(`GitHub GraphQL API returned invalid JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`));
                    }
                });
            }
        );
        req.on('error', (err: Error) => reject(new Error(`Failed to reach GitHub GraphQL API: ${err.message}`)));
        req.write(body);
        req.end();
    });
}

function firstLine(body: string): string {
    return body.trim().split(/\r?\n/, 1)[0] ?? body.trim();
}

function summarizeThreadBody(body: string): string {
    const summary = firstLine(body).trim();
    return summary.length > 120 ? `${summary.slice(0, 117).trimEnd()}...` : summary;
}

function pushUnique(list: string[], value: string): void {
    const normalized = value.trim();
    if (normalized && !list.includes(normalized)) {
        list.push(normalized);
    }
}

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

    async listOpenPrs(payload: { owner: string; repo: string }): Promise<InboxItem[]> {
        const { owner, repo } = payload;
        const { json } = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls?state=open&per_page=100&sort=updated&direction=desc`, method: 'GET' },
            this.token
        );
        if (!Array.isArray(json)) {
            return [];
        }
        return json.flatMap((item: {
            number?: number;
            title?: string;
            html_url?: string;
            state?: string;
            draft?: boolean;
            updated_at?: string;
            user?: { login?: string };
            labels?: Array<{ name?: string }>;
        }) => {
            if (!item.number || !item.title || !item.html_url) {
                return [];
            }
            return [{
                number: item.number,
                title: item.title,
                url: item.html_url,
                state: item.state,
                draft: item.draft,
                author: item.user?.login,
                updatedAt: item.updated_at,
                labels: item.labels?.map(label => label.name).filter((name): name is string => !!name) ?? [],
            }];
        });
    }

    async getReadiness(payload: { owner: string; repo: string; number: number }): Promise<ReadinessSummary> {
        const { owner, repo, number } = payload;
        const blockers: string[] = [];
        const info: string[] = [];
        const updatedAt = new Date().toLocaleString();

        const prResp = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}`, method: 'GET' },
            this.token
        );
        if (prResp.statusCode !== 200 || typeof prResp.json !== 'object' || prResp.json === null) {
            throw new Error(`GitHub API error ${prResp.statusCode}${ghHint(prResp.statusCode)}`);
        }

        const pr = prResp.json as {
            draft?: boolean;
            mergeable?: boolean | null;
            mergeable_state?: string;
            head?: { sha?: string; ref?: string };
            base?: { ref?: string };
            requested_reviewers?: Array<{ login?: string }>;
        };
        const headSha = pr.head?.sha;

        if (pr.draft) {
            blockers.push('PR is marked draft');
        }

        switch ((pr.mergeable_state ?? '').toLowerCase()) {
            case 'clean':
                pushUnique(info, 'GitHub reports a clean merge state');
                break;
            case 'behind':
                pushUnique(info, 'Head branch is behind the base branch');
                break;
            case 'blocked':
                blockers.push('GitHub merge is blocked by branch protection');
                break;
            case 'dirty':
                blockers.push('GitHub reports merge conflicts');
                break;
            case 'draft':
                blockers.push('PR is still in draft state');
                break;
            case 'unstable':
                blockers.push('Required status checks are not passing');
                break;
            case 'unknown':
            case '':
                pushUnique(info, 'GitHub mergeability is still being calculated');
                break;
            default:
                pushUnique(info, `Merge state: ${pr.mergeable_state}`);
                break;
        }

        if (pr.mergeable === false) {
            blockers.push('GitHub reports merge conflicts');
        } else if (pr.mergeable === null) {
            pushUnique(info, 'GitHub is still calculating mergeability');
        }

        const reviewers = pr.requested_reviewers?.map(r => r.login).filter(isNonEmptyString) ?? [];
        if (reviewers.length > 0) {
            pushUnique(info, `Requested reviewers: ${reviewers.slice(0, 3).join(', ')}`);
        }

        if (headSha) {
            const statusResp = await ghRequest(
                this.baseUrl,
                { path: `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(headSha)}/status`, method: 'GET' },
                this.token
            );
            if (statusResp.statusCode === 200 && typeof statusResp.json === 'object' && statusResp.json !== null) {
                const status = statusResp.json as { state?: string; statuses?: Array<{ context?: string; state?: string }> };
                const state = (status.state ?? '').toLowerCase();
                if (state === 'success') {
                    pushUnique(info, 'Commit statuses: passing');
                } else if (state === 'pending') {
                    blockers.push('Commit statuses are pending');
                } else if (state === 'failure' || state === 'error') {
                    blockers.push('Commit statuses are failing');
                } else if (state) {
                    pushUnique(info, `Commit status: ${state}`);
                }
                const contexts = status.statuses?.map(s => `${s.context ?? 'status'}:${s.state ?? 'unknown'}`) ?? [];
                if (contexts.length > 0) {
                    pushUnique(info, `Status contexts: ${contexts.slice(0, 3).join(', ')}`);
                }
            }

            const checksResp = await ghRequest(
                this.baseUrl,
                { path: `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(headSha)}/check-runs?filter=latest&per_page=100`, method: 'GET' },
                this.token
            );
            if (checksResp.statusCode === 200 && typeof checksResp.json === 'object' && checksResp.json !== null) {
                const checks = checksResp.json as { check_runs?: Array<{ name?: string; conclusion?: string; status?: string }> };
                const runs = Array.isArray(checks.check_runs) ? checks.check_runs : [];
                if (runs.length > 0) {
                    const failing = runs.filter(run => ['failure', 'cancelled', 'timed_out', 'action_required'].includes((run.conclusion ?? '').toLowerCase()));
                    const pending = runs.filter(run => ['queued', 'in_progress', 'requested'].includes((run.status ?? '').toLowerCase()));
                    const passing = runs.filter(run => (run.conclusion ?? '').toLowerCase() === 'success');
                    if (failing.length > 0) {
                        blockers.push(`Check runs failing: ${failing.slice(0, 3).map(run => run.name ?? 'check').join(', ')}`);
                    }
                    if (pending.length > 0) {
                        blockers.push(`Check runs pending: ${pending.slice(0, 3).map(run => run.name ?? 'check').join(', ')}`);
                    }
                    if (passing.length > 0 && failing.length === 0 && pending.length === 0) {
                        pushUnique(info, `Check runs passing: ${passing.length}/${runs.length}`);
                    }
                }
            }
        }

        const reviewsResp = await ghRequest(
            this.baseUrl,
            { path: `/repos/${enc(owner)}/${enc(repo)}/pulls/${number}/reviews?per_page=100`, method: 'GET' },
            this.token
        );
        if (Array.isArray(reviewsResp.json)) {
            const latestByUser = new Map<string, { state: string; submitted_at: string }>();
            for (const review of reviewsResp.json as Array<{ state?: string; submitted_at?: string; user?: { login?: string } }>) {
                const login = review.user?.login;
                const submittedAt = review.submitted_at ?? '';
                if (!login || !submittedAt) {
                    continue;
                }
                const current = latestByUser.get(login);
                if (!current || submittedAt > current.submitted_at) {
                    latestByUser.set(login, { state: (review.state ?? '').toUpperCase(), submitted_at: submittedAt });
                }
            }
            const approvals = Array.from(latestByUser.values()).filter(review => review.state === 'APPROVED').length;
            const changesRequested = Array.from(latestByUser.values()).filter(review => review.state === 'CHANGES_REQUESTED').length;
            if (changesRequested > 0) {
                blockers.push(`Changes requested by ${changesRequested} reviewer(s)`);
            }
            if (approvals > 0) {
                pushUnique(info, `Approvals: ${approvals}`);
            } else {
                pushUnique(info, 'No approving review recorded yet');
            }
        }

        const state = blockers.length > 0 ? 'blocked' : (info.length > 0 ? 'ready' : 'unknown');
        const summary = blockers[0] ?? info[0] ?? 'No readiness data available';
        return { state, summary, blockers, info, updatedAt };
    }

    async listReviewThreads(payload: { owner: string; repo: string; number: number }): Promise<ReviewThread[]> {
        const { owner, repo, number } = payload;
        const query = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          path
          line
          isResolved
          comments(first: 100) {
            nodes {
              body
              url
              createdAt
              author { login }
              path
              line
              originalLine
            }
          }
        }
      }
    }
  }
}`;
        const { statusCode, json } = await ghGraphqlRequest(this.baseUrl, this.token, query, { owner, repo, number });
        if (statusCode !== 200 || typeof json !== 'object' || json === null) {
            throw new Error(`GitHub GraphQL API error ${statusCode}${ghHint(statusCode)}`);
        }
        const data = json as {
            errors?: Array<{ message?: string }>;
            data?: {
                repository?: {
                    pullRequest?: {
                        reviewThreads?: {
                            nodes?: Array<{
                                id?: string;
                                path?: string;
                                line?: number;
                                isResolved?: boolean;
                                comments?: {
                                    nodes?: Array<{
                                        body?: string;
                                        url?: string;
                                        createdAt?: string;
                                        author?: { login?: string };
                                        path?: string;
                                        line?: number;
                                        originalLine?: number;
                                    }>;
                                };
                            }>;
                        };
                    };
                };
            };
        };
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            const message = data.errors.map(err => err.message ?? 'unknown GraphQL error').join('; ');
            throw new Error(`GitHub GraphQL API error: ${message}`);
        }
        const threads = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
        return threads.flatMap((thread, index) => {
            const comments = thread.comments?.nodes?.filter((comment): comment is NonNullable<typeof comment> => !!comment && typeof comment.body === 'string') ?? [];
            if (comments.length === 0) {
                return [];
            }
            const firstComment = comments[0];
            const path = thread.path ?? firstComment.path;
            const line = thread.line ?? firstComment.line ?? firstComment.originalLine;
            const threadState = thread.isResolved ? 'resolved' : 'unresolved';
            const title = path
                ? `${path}${typeof line === 'number' ? `:${line}` : ''}`
                : `Review thread ${index + 1}`;
            return [{
                id: thread.id ?? `${path ?? 'thread'}:${line ?? index}`,
                title: `${title} · ${threadState}`,
                url: firstComment.url ?? `https://github.com/${owner}/${repo}/pull/${number}`,
                path,
                line: typeof line === 'number' ? line : undefined,
                state: threadState,
                actionable: !thread.isResolved,
                comments: comments.map(comment => ({
                    author: comment.author?.login ?? undefined,
                    body: summarizeThreadBody(comment.body),
                    url: comment.url ?? undefined,
                    createdAt: comment.createdAt,
                })),
            }];
        });
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
