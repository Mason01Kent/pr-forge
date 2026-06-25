import * as assert from 'assert';
import * as http from 'http';
import { GitHubScmProvider, GitLabScmProvider } from '../scm';

type RecordedRequest = { method: string; path: string; body: string };

function mockServer(responder: (req: RecordedRequest) => { statusCode: number; body: unknown }): Promise<{ url: string; requests: RecordedRequest[]; close: () => void }> {
    return new Promise((resolve) => {
        const requests: RecordedRequest[] = [];
        const server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                const recorded: RecordedRequest = {
                    method: req.method ?? 'GET',
                    path: req.url ?? '/',
                    body: Buffer.concat(chunks).toString('utf-8'),
                };
                requests.push(recorded);
                const response = responder(recorded);
                const body = JSON.stringify(response.body);
                res.writeHead(response.statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() });
                res.end(body);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ url: `http://127.0.0.1:${addr.port}`, requests, close: () => server.close() });
        });
    });
}

describe('SCM metadata automation', () => {
    it('lists open GitHub pull requests', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /repos/o/r/pulls?state=open&per_page=100&sort=updated&direction=desc':
                    return {
                        statusCode: 200,
                        body: [{
                            number: 4,
                            title: 'Add inbox',
                            html_url: 'https://github.com/o/r/pull/4',
                            state: 'open',
                            draft: false,
                            updated_at: '2026-06-25T10:00:00Z',
                            user: { login: 'alice' },
                            labels: [{ name: 'enhancement' }],
                        }],
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitHubScmProvider('tok', server.url);
            const items = await provider.listOpenPrs({ owner: 'o', repo: 'r' });
            assert.deepStrictEqual(items, [{
                number: 4,
                title: 'Add inbox',
                url: 'https://github.com/o/r/pull/4',
                state: 'open',
                draft: false,
                author: 'alice',
                updatedAt: '2026-06-25T10:00:00Z',
                labels: ['enhancement'],
            }]);
        } finally {
            server.close();
        }
    });

    it('summarizes GitHub merge readiness from statuses, checks, and reviews', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /repos/o/r/pulls/4':
                    return {
                        statusCode: 200,
                        body: {
                            draft: false,
                            mergeable: true,
                            mergeable_state: 'clean',
                            head: { sha: 'abc123', ref: 'feat' },
                            requested_reviewers: [{ login: 'alice' }],
                        },
                    };
                case 'GET /repos/o/r/commits/abc123/status':
                    return { statusCode: 200, body: { state: 'success', statuses: [{ context: 'ci', state: 'success' }] } };
                case 'GET /repos/o/r/commits/abc123/check-runs?filter=latest&per_page=100':
                    return { statusCode: 200, body: { check_runs: [{ name: 'build', conclusion: 'success', status: 'completed' }] } };
                case 'GET /repos/o/r/pulls/4/reviews?per_page=100':
                    return {
                        statusCode: 200,
                        body: [
                            { state: 'APPROVED', submitted_at: '2026-06-25T12:00:00Z', user: { login: 'alice' } },
                        ],
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitHubScmProvider('tok', server.url);
            const readiness = await provider.getReadiness({ owner: 'o', repo: 'r', number: 4 });
            assert.strictEqual(readiness.state, 'ready');
            assert.ok(readiness.info.some(line => line.includes('passing') || line.includes('Approvals')));
            assert.strictEqual(readiness.blockers.length, 0);
        } finally {
            server.close();
        }
    });

    it('lists GitHub review threads and comments', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'POST /graphql':
                    return {
                        statusCode: 200,
                        body: {
                            data: {
                                repository: {
                                    pullRequest: {
                                        reviewThreads: {
                                            nodes: [
                                                {
                                                    id: 'thread-1',
                                                    path: 'src/app.ts',
                                                    line: 12,
                                                    isResolved: false,
                                                    comments: {
                                                        nodes: [
                                                            {
                                                                body: 'Please tighten this up',
                                                                url: 'https://github.com/o/r/pull/4#discussion_r1',
                                                                createdAt: '2026-06-25T10:00:00Z',
                                                                author: { login: 'alice' },
                                                                path: 'src/app.ts',
                                                                line: 12,
                                                            },
                                                            {
                                                                body: 'Fixed in the next commit',
                                                                url: 'https://github.com/o/r/pull/4#discussion_r2',
                                                                createdAt: '2026-06-25T10:05:00Z',
                                                                author: { login: 'bob' },
                                                                path: 'src/app.ts',
                                                                line: 12,
                                                            },
                                                        ],
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitHubScmProvider('tok', server.url);
            const threads = await provider.listReviewThreads({ owner: 'o', repo: 'r', number: 4 });
            assert.deepStrictEqual(threads, [{
                id: 'thread-1',
                title: 'src/app.ts:12 · unresolved',
                url: 'https://github.com/o/r/pull/4#discussion_r1',
                path: 'src/app.ts',
                line: 12,
                state: 'unresolved',
                actionable: true,
                comments: [
                    {
                        author: 'alice',
                        body: 'Please tighten this up',
                        url: 'https://github.com/o/r/pull/4#discussion_r1',
                        createdAt: '2026-06-25T10:00:00Z',
                    },
                    {
                        author: 'bob',
                        body: 'Fixed in the next commit',
                        url: 'https://github.com/o/r/pull/4#discussion_r2',
                        createdAt: '2026-06-25T10:05:00Z',
                    },
                ],
            }]);
        } finally {
            server.close();
        }
    });

    it('attaches GitHub labels, assignees, reviewers, and milestone metadata', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'POST /repos/o/r/pulls':
                    return { statusCode: 201, body: { html_url: 'https://github.com/o/r/pull/1', number: 1 } };
                case 'POST /repos/o/r/issues/1/labels':
                case 'POST /repos/o/r/issues/1/assignees':
                case 'POST /repos/o/r/pulls/1/requested_reviewers':
                    return { statusCode: 200, body: {} };
                case 'GET /repos/o/r/milestones?state=all&per_page=100':
                    return { statusCode: 200, body: [{ number: 7, title: 'v1.0' }] };
                case 'PATCH /repos/o/r/issues/1':
                    return { statusCode: 200, body: {} };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitHubScmProvider('tok', server.url);
            const result = await provider.createPr({
                owner: 'o',
                repo: 'r',
                title: 'T',
                body: 'B',
                head: 'feat',
                base: 'main',
                token: 'tok',
                labels: ['bug', 'release'],
                assignees: ['alice'],
                reviewers: ['bob'],
                milestone: 'v1.0',
            });
            assert.strictEqual(result.number, 1);
            const createBody = JSON.parse(server.requests[0].body) as { title: string; body: string };
            assert.strictEqual(createBody.title, 'T');
            assert.strictEqual(server.requests.length, 6);
            assert.deepStrictEqual(JSON.parse(server.requests[1].body), { labels: ['bug', 'release'] });
            assert.deepStrictEqual(JSON.parse(server.requests[2].body), { assignees: ['alice'] });
            assert.deepStrictEqual(JSON.parse(server.requests[3].body), { reviewers: ['bob'] });
            assert.strictEqual(server.requests[4].path, '/repos/o/r/milestones?state=all&per_page=100');
            assert.deepStrictEqual(JSON.parse(server.requests[5].body), { milestone: 7 });
        } finally {
            server.close();
        }
    });

    it('includes GitLab labels, assignee IDs, reviewer IDs, and milestone on create', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /users?username=alice':
                    return { statusCode: 200, body: [{ id: 21, username: 'alice' }] };
                case 'GET /users?username=bob':
                    return { statusCode: 200, body: [{ id: 22, username: 'bob' }] };
                case 'POST /projects/o%2Fr/merge_requests':
                    return { statusCode: 201, body: { iid: 9, web_url: 'https://gitlab.com/o/r/-/merge_requests/9' } };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const result = await provider.createPr({
                owner: 'o',
                repo: 'r',
                title: 'T',
                body: 'B',
                head: 'feat',
                base: 'main',
                token: 'tok',
                labels: ['bug', 'release'],
                assignees: ['alice'],
                reviewers: ['bob'],
                milestone: 'v1.0',
            });
            assert.strictEqual(result.number, 9);
            const createBody = JSON.parse(server.requests[2].body) as Record<string, unknown>;
            assert.strictEqual(createBody.labels, 'bug,release');
            assert.deepStrictEqual(createBody.assignee_ids, [21]);
            assert.deepStrictEqual(createBody.reviewer_ids, [22]);
            assert.strictEqual(createBody.milestone, 'v1.0');
        } finally {
            server.close();
        }
    });

    it('lists open GitLab merge requests', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /projects/o%2Fr/merge_requests?state=opened&scope=all&per_page=100&order_by=updated_at&sort=desc':
                    return {
                        statusCode: 200,
                        body: [{
                            iid: 9,
                            title: 'Inbox',
                            web_url: 'https://gitlab.com/o/r/-/merge_requests/9',
                            state: 'opened',
                            draft: true,
                            updated_at: '2026-06-25T11:00:00Z',
                            author: { username: 'bob' },
                            labels: ['backend', 'priority'],
                        }],
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const items = await provider.listOpenPrs({ owner: 'o', repo: 'r' });
            assert.deepStrictEqual(items, [{
                number: 9,
                title: 'Inbox',
                url: 'https://gitlab.com/o/r/-/merge_requests/9',
                state: 'opened',
                draft: true,
                author: 'bob',
                updatedAt: '2026-06-25T11:00:00Z',
                labels: ['backend', 'priority'],
            }]);
        } finally {
            server.close();
        }
    });

    it('summarizes GitLab merge readiness with blockers', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /projects/o%2Fr/merge_requests/9':
                    return {
                        statusCode: 200,
                        body: {
                            draft: false,
                            work_in_progress: false,
                            has_conflicts: false,
                            blocking_discussions_resolved: true,
                            detailed_merge_status: 'checking',
                            head_pipeline: { status: 'pending' },
                        },
                    };
                case 'GET /projects/o%2Fr/merge_requests/9/approvals':
                    return {
                        statusCode: 200,
                        body: {
                            approvals_left: 1,
                            approvals_required: 2,
                            approved_by: [{ user: { username: 'alice' } }],
                        },
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const readiness = await provider.getReadiness({ owner: 'o', repo: 'r', number: 9 });
            assert.strictEqual(readiness.state, 'blocked');
            assert.ok(readiness.blockers.some(line => line.includes('approval') || line.includes('pipeline')));
            assert.ok(readiness.info.some(line => line.includes('Approvals required') || line.includes('Approved by')));
        } finally {
            server.close();
        }
    });

    it('lists GitLab review threads and comments', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'GET /projects/o%2Fr/merge_requests/9/discussions?per_page=100':
                    return {
                        statusCode: 200,
                        body: [
                            {
                                id: 'disc-1',
                                resolved: false,
                                resolvable: true,
                                notes: [
                                    {
                                        body: 'Please rename this method',
                                        web_url: 'https://gitlab.com/o/r/-/merge_requests/9#note_1',
                                        created_at: '2026-06-25T11:00:00Z',
                                        author: { username: 'alice' },
                                        position: {
                                            new_path: 'src/app.ts',
                                            new_line: 21,
                                        },
                                    },
                                    {
                                        body: 'Updated in the latest push',
                                        web_url: 'https://gitlab.com/o/r/-/merge_requests/9#note_2',
                                        created_at: '2026-06-25T11:05:00Z',
                                        author: { username: 'bob' },
                                    },
                                ],
                            },
                        ],
                    };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const threads = await provider.listReviewThreads({ owner: 'o', repo: 'r', number: 9 });
            assert.deepStrictEqual(threads, [{
                id: 'disc-1',
                title: 'src/app.ts:21 · unresolved',
                url: 'https://gitlab.com/o/r/-/merge_requests/9#note_1',
                path: 'src/app.ts',
                line: 21,
                state: 'unresolved',
                actionable: true,
                comments: [
                    {
                        author: 'alice',
                        body: 'Please rename this method',
                        url: 'https://gitlab.com/o/r/-/merge_requests/9#note_1',
                        createdAt: '2026-06-25T11:00:00Z',
                    },
                    {
                        author: 'bob',
                        body: 'Updated in the latest push',
                        url: 'https://gitlab.com/o/r/-/merge_requests/9#note_2',
                        createdAt: '2026-06-25T11:05:00Z',
                    },
                ],
            }]);
        } finally {
            server.close();
        }
    });

    it('posts GitLab review comments as anchored discussions when versions are available', async () => {
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'POST /projects/o%2Fr/merge_requests/9/notes':
                    return { statusCode: 201, body: { id: 41, noteable_iid: 9 } };
                case 'GET /projects/o%2Fr/merge_requests/9/versions':
                    return {
                        statusCode: 200,
                        body: [{
                            base_commit_sha: 'base',
                            head_commit_sha: 'head',
                            start_commit_sha: 'start',
                        }],
                    };
                case 'POST /projects/o%2Fr/merge_requests/9/discussions':
                    return { statusCode: 201, body: { id: 'disc-1', notes: [{ id: 88 }] } };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const result = await provider.createReview({
                owner: 'o',
                repo: 'r',
                number: 9,
                body: 'Summary',
                comments: [{ path: 'src/app.ts', line: 12, side: 'RIGHT', body: 'Comment' }],
            });
            assert.ok(result.url.includes('#note_41'));
            assert.strictEqual(server.requests[2].path, '/projects/o%2Fr/merge_requests/9/discussions');
            const discussionBody = JSON.parse(server.requests[2].body) as Record<string, unknown>;
            assert.deepStrictEqual(discussionBody.position, {
                position_type: 'text',
                base_sha: 'base',
                head_sha: 'head',
                start_sha: 'start',
                new_path: 'src/app.ts',
                old_path: 'src/app.ts',
                new_line: 12,
            });
        } finally {
            server.close();
        }
    });

    it('falls back to a note when GitLab discussion anchoring is unavailable', async () => {
        let noteCount = 0;
        const server = await mockServer((req) => {
            switch (`${req.method} ${req.path}`) {
                case 'POST /projects/o%2Fr/merge_requests/9/notes':
                    noteCount += 1;
                    return { statusCode: 201, body: { id: 41, noteable_iid: 9 } };
                case 'GET /projects/o%2Fr/merge_requests/9/versions':
                    return { statusCode: 200, body: [] };
                default:
                    return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
            }
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const result = await provider.createReview({
                owner: 'o',
                repo: 'r',
                number: 9,
                body: 'Summary',
                comments: [{ path: 'src/app.ts', line: 12, side: 'RIGHT', body: 'Comment' }],
            });
            assert.ok(result.url.includes('#note_41'));
            assert.strictEqual(server.requests[1].path, '/projects/o%2Fr/merge_requests/9/versions');
            assert.strictEqual(server.requests[2].path, '/projects/o%2Fr/merge_requests/9/notes');
            assert.strictEqual(noteCount, 2);
        } finally {
            server.close();
        }
    });
});
