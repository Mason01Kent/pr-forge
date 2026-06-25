import * as https from 'https';
import * as http from 'http';
import { ScmProvider, PrPayload, PrResult, ReviewComment, InboxItem, IssueItem, ReadinessSummary, ReviewThread } from './index';

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

function summarizeThreadBody(body: string): string {
    const trimmed = body.trim();
    const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? trimmed;
    return firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}...` : firstLine;
}

function pushUnique(list: string[], value: string): void {
    const normalized = value.trim();
    if (normalized && !list.includes(normalized)) {
        list.push(normalized);
    }
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

    async listOpenPrs(payload: { owner: string; repo: string }): Promise<InboxItem[]> {
        const { owner, repo } = payload;
        const pid = projectId(owner, repo);
        const query = 'state=opened&scope=all&per_page=100&order_by=updated_at&sort=desc';
        const { json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests?${query}`, 'GET');
        if (!Array.isArray(json)) {
            return [];
        }
        return json.flatMap((item: {
            iid?: number;
            title?: string;
            web_url?: string;
            state?: string;
            draft?: boolean;
            updated_at?: string;
            author?: { username?: string; name?: string };
            labels?: string[];
        }) => {
            if (!item.iid || !item.title || !item.web_url) {
                return [];
            }
            return [{
                number: item.iid,
                title: item.title,
                url: item.web_url,
                state: item.state,
                draft: item.draft,
                author: item.author?.username ?? item.author?.name,
                updatedAt: item.updated_at,
                labels: item.labels ?? [],
            }];
        });
    }

    async listOpenIssues(payload: { owner: string; repo: string }): Promise<IssueItem[]> {
        const { owner, repo } = payload;
        const pid = projectId(owner, repo);
        const query = 'state=opened&scope=all&per_page=100&order_by=updated_at&sort=desc';
        const { json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/issues?${query}`, 'GET');
        if (!Array.isArray(json)) {
            return [];
        }
        return json.flatMap((item: {
            iid?: number;
            title?: string;
            web_url?: string;
            state?: string;
            updated_at?: string;
            author?: { username?: string; name?: string };
            labels?: string[];
            description?: string;
        }) => {
            if (!item.iid || !item.title || !item.web_url) {
                return [];
            }
            return [{
                number: item.iid,
                title: item.title,
                url: item.web_url,
                body: item.description,
                state: item.state,
                author: item.author?.username ?? item.author?.name,
                updatedAt: item.updated_at,
                labels: item.labels ?? [],
            }];
        });
    }

    async getReadiness(payload: { owner: string; repo: string; number: number }): Promise<ReadinessSummary> {
        const { owner, repo, number } = payload;
        const pid = projectId(owner, repo);
        const blockers: string[] = [];
        const info: string[] = [];
        const updatedAt = new Date().toLocaleString();

        const mrResp = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests/${number}`, 'GET');
        if (mrResp.statusCode !== 200 || typeof mrResp.json !== 'object' || mrResp.json === null) {
            throw new Error(`GitLab API error ${mrResp.statusCode}${glHint(mrResp.statusCode)}`);
        }

        const mr = mrResp.json as {
            draft?: boolean;
            work_in_progress?: boolean;
            has_conflicts?: boolean;
            blocking_discussions_resolved?: boolean;
            detailed_merge_status?: string;
            head_pipeline?: { status?: string };
        };

        if (mr.draft || mr.work_in_progress) {
            blockers.push('Merge request is marked draft');
        }
        if (mr.has_conflicts) {
            blockers.push('Merge request has conflicts');
        }
        if (mr.blocking_discussions_resolved === false) {
            blockers.push('Blocking discussions are unresolved');
        }

        switch ((mr.detailed_merge_status ?? '').toLowerCase()) {
            case 'can_be_merged':
                pushUnique(info, 'GitLab reports the merge request can be merged');
                break;
            case 'checking':
            case 'approvals_syncing':
            case 'unchecked':
                pushUnique(info, `Merge status: ${mr.detailed_merge_status}`);
                break;
            case 'cannot_be_merged':
            case 'cannot_be_merged_recheck':
            case 'merge_conflict':
            case 'conflicts':
                blockers.push('GitLab reports the merge request cannot be merged cleanly');
                break;
            case 'draft_status':
            case 'draft':
                blockers.push('Merge request is still in draft state');
                break;
            default:
                if (mr.detailed_merge_status) {
                    pushUnique(info, `Merge status: ${mr.detailed_merge_status}`);
                }
                break;
        }

        const pipelineStatus = mr.head_pipeline?.status?.toLowerCase();
        if (pipelineStatus === 'success') {
            pushUnique(info, 'Latest pipeline passed');
        } else if (['failed', 'canceled', 'cancelled'].includes(pipelineStatus ?? '')) {
            blockers.push('Latest pipeline failed');
        } else if (['pending', 'running', 'created', 'preparing'].includes(pipelineStatus ?? '')) {
            blockers.push(`Latest pipeline is ${pipelineStatus}`);
        } else if (pipelineStatus) {
            pushUnique(info, `Latest pipeline: ${pipelineStatus}`);
        }

        try {
            const approvalsResp = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests/${number}/approvals`, 'GET');
            if (approvalsResp.statusCode === 200 && typeof approvalsResp.json === 'object' && approvalsResp.json !== null) {
                const approvals = approvalsResp.json as {
                    approvals_left?: number;
                    approvals_required?: number;
                    approved_by?: Array<{ user?: { username?: string; name?: string } }>;
                };
                if (typeof approvals.approvals_left === 'number' && approvals.approvals_left > 0) {
                    blockers.push(`${approvals.approvals_left} approval(s) required`);
                }
                if (typeof approvals.approvals_required === 'number' && approvals.approvals_required > 0) {
                    pushUnique(info, `Approvals required: ${approvals.approvals_required}`);
                }
                const approvedBy = approvals.approved_by?.map(entry => entry.user?.username ?? entry.user?.name).filter((value): value is string => !!value) ?? [];
                if (approvedBy.length > 0) {
                    pushUnique(info, `Approved by: ${approvedBy.slice(0, 3).join(', ')}`);
                }
            }
        } catch {
            // Premium approval data is optional; keep the summary usable without it.
        }

        const state = blockers.length > 0 ? 'blocked' : (info.length > 0 ? 'ready' : 'unknown');
        const summary = blockers[0] ?? info[0] ?? 'No readiness data available';
        return { state, summary, blockers, info, updatedAt };
    }

    async listReviewThreads(payload: { owner: string; repo: string; number: number }): Promise<ReviewThread[]> {
        const { owner, repo, number } = payload;
        const pid = projectId(owner, repo);
        const { statusCode, json } = await glRequest(this.baseUrl, this.token, `/projects/${pid}/merge_requests/${number}/discussions?per_page=100`, 'GET');
        if (statusCode !== 200 || !Array.isArray(json)) {
            throw new Error(`GitLab API error ${statusCode}${glHint(statusCode)}`);
        }
        return json.flatMap((discussion: {
            id?: string;
            resolved?: boolean;
            resolvable?: boolean;
            individual_note?: boolean;
            notes?: Array<{
                body?: string;
                author?: { username?: string; name?: string };
                web_url?: string;
                created_at?: string;
                position?: {
                    new_path?: string;
                    old_path?: string;
                    new_line?: number;
                    old_line?: number;
                };
            }>;
        }, index: number) => {
            const notes = discussion.notes ?? [];
            if (notes.length === 0) {
                return [];
            }
            const firstNote = notes[0];
            const position = firstNote.position;
            const path = position?.new_path ?? position?.old_path;
            const line = position?.new_line ?? position?.old_line;
            const state = discussion.resolved ? 'resolved' : 'unresolved';
            const actionable = discussion.resolvable !== false && !discussion.resolved;
            const titleBase = path
                ? `${path}${typeof line === 'number' ? `:${line}` : ''}`
                : discussion.individual_note ? 'Discussion note' : `Discussion ${index + 1}`;
            return [{
                id: discussion.id ?? `${titleBase}:${index}`,
                title: `${titleBase} · ${state}`,
                url: firstNote.web_url ?? `${this.baseUrl.replace('/api/v4', '')}/${owner}/${repo}/-/merge_requests/${number}`,
                path,
                line: typeof line === 'number' ? line : undefined,
                state,
                actionable,
                comments: notes
                    .filter((note): note is {
                        body: string;
                        author?: { username?: string; name?: string };
                        web_url?: string;
                        created_at?: string;
                        position?: {
                            new_path?: string;
                            old_path?: string;
                            new_line?: number;
                            old_line?: number;
                        };
                    } => !!note && typeof note.body === 'string')
                    .map(note => ({
                        author: note.author?.username ?? note.author?.name ?? undefined,
                        body: summarizeThreadBody(note.body),
                        url: note.web_url ?? undefined,
                        createdAt: note.created_at,
                    })),
            }];
        });
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
