import * as assert from 'assert';
import * as http from 'http';
import { parseRemote, GitLabScmProvider, GitHubScmProvider } from '../scm';

describe('parseRemote', () => {
  it('parses GitHub HTTPS remotes', () => {
    const result = parseRemote('https://github.com/owner/repo.git', 'token');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitHub');
    assert.ok(((result?.provider as unknown as { baseUrl?: string })?.baseUrl ?? '').includes('api.github.com'));
  });

  it('parses GitHub SSH remotes', () => {
    const result = parseRemote('git@github.com:owner/repo.git', 'token');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitHub');
  });

  it('parses GitHub Enterprise remotes with an API base', () => {
    const result = parseRemote('https://github.enterprise.local/owner/repo', 'token');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitHub');
    assert.ok(((result?.provider as unknown as { baseUrl?: string })?.baseUrl ?? '').endsWith('/api/v3'));
  });

  it('parses GitLab HTTPS remotes', () => {
    const result = parseRemote('https://gitlab.com/group/repo.git', 'token');
    assert.strictEqual(result?.owner, 'group');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitLab');
  });

  it('parses GitLab SSH remotes', () => {
    const result = parseRemote('git@gitlab.com:group/repo.git', 'token');
    assert.strictEqual(result?.owner, 'group');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitLab');
  });

  it('parses GitLab self-managed remotes with an API base', () => {
    const result = parseRemote('https://gitlab.company.local/group/subgroup/repo', 'token');
    assert.strictEqual(result?.owner, 'group/subgroup');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitLab');
    assert.ok(((result?.provider as unknown as { baseUrl?: string })?.baseUrl ?? '').endsWith('/api/v4'));
  });

  it('returns null for unsupported remotes', () => {
    assert.strictEqual(parseRemote('https://bitbucket.org/owner/repo.git', 'token'), null);
  });

  it('returns a GitHub provider exposing the full SCM interface', () => {
    const result = parseRemote('https://github.com/owner/repo.git', 'token');
    assert.ok(result);
    assert.strictEqual(result!.provider.name, 'GitHub');
    for (const method of ['createPr', 'findOpenPr', 'listOpenPrs', 'getReadiness', 'listReviewThreads', 'replyToReviewThread', 'resolveReviewThread', 'reopenReviewThread', 'updatePr', 'postPrComment', 'createReview'] as const) {
      assert.strictEqual(typeof result!.provider[method], 'function', `missing ${method}`);
    }
  });

  it('parses GitLab HTTPS remotes with group path', () => {
    const result = parseRemote('https://gitlab.com/mygroup/myrepo.git', 'tok');
    assert.strictEqual(result?.owner, 'mygroup');
    assert.strictEqual(result?.repo, 'myrepo');
    assert.strictEqual(result?.provider.name, 'GitLab');
  });

  it('parses GitLab SSH remotes', () => {
    const result = parseRemote('git@gitlab.com:owner/repo.git', 'tok');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitLab');
  });

  it('still returns null for Bitbucket remotes', () => {
    assert.strictEqual(parseRemote('https://bitbucket.org/owner/repo.git', 'tok'), null);
  });

  it('GitLabScmProvider exposes the full SCM interface', () => {
    const provider = new GitLabScmProvider('tok');
    assert.strictEqual(provider.name, 'GitLab');
    for (const method of ['createPr', 'findOpenPr', 'listOpenPrs', 'getReadiness', 'listReviewThreads', 'replyToReviewThread', 'resolveReviewThread', 'reopenReviewThread', 'updatePr', 'postPrComment', 'createReview'] as const) {
      assert.strictEqual(typeof provider[method], 'function', `missing ${method}`);
    }
  });
});

// Helper: spin up a one-shot HTTP server that responds with a fixed status + body
function mockGlServer(statusCode: number, responseBody: unknown): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
        const server = http.createServer((_req, res) => {
            const body = JSON.stringify(responseBody);
            res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() });
            res.end(body);
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
        });
    });
}

function mockApiServer(
    handler: (req: { method: string; path: string; body: string }) => { statusCode: number; body: unknown },
): Promise<{ url: string; close: () => void; requests: Array<{ method: string; path: string; body: string }> }> {
    return new Promise((resolve) => {
        const requests: Array<{ method: string; path: string; body: string }> = [];
        const server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                const record = {
                    method: req.method ?? 'GET',
                    path: req.url ?? '/',
                    body,
                };
                requests.push(record);
                const response = handler(record);
                const responseBody = JSON.stringify(response.body);
                res.writeHead(response.statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(responseBody).toString() });
                res.end(responseBody);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close(), requests });
        });
    });
}

describe('GitLabScmProvider', () => {
    it('createPr returns url and number on 201', async () => {
        const mock = await mockGlServer(201, { iid: 42, web_url: 'https://gitlab.com/g/r/-/merge_requests/42' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.createPr({ owner: 'g', repo: 'r', title: 'T', body: 'B', head: 'feat', base: 'main', token: 'tok' });
            assert.strictEqual(result.number, 42);
            assert.ok(result.url.includes('42'));
        } finally { mock.close(); }
    });

    it('createPr throws with hint on 422', async () => {
        const mock = await mockGlServer(422, { message: 'Another open merge request already exists for this source branch' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            await assert.rejects(
                () => provider.createPr({ owner: 'g', repo: 'r', title: 'T', body: 'B', head: 'feat', base: 'main', token: 'tok' }),
                (err: Error) => { assert.ok(err.message.includes('422') || err.message.includes('Unprocessable') || err.message.includes('open merge request')); return true; }
            );
        } finally { mock.close(); }
    });

    it('findOpenPr returns null when empty array', async () => {
        const mock = await mockGlServer(200, []);
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.findOpenPr({ owner: 'g', repo: 'r', head: 'feat', token: 'tok' });
            assert.strictEqual(result, null);
        } finally { mock.close(); }
    });

    it('findOpenPr returns PR details for GitHub', async () => {
        const mock = await mockGlServer(200, [{ html_url: 'https://github.com/g/r/pull/12', number: 12, title: 'Draft update', body: 'Body v2', draft: true }]);
        try {
            const provider = new GitHubScmProvider('tok', mock.url);
            const result = await provider.findOpenPr({ owner: 'g', repo: 'r', head: 'feat', token: 'tok' });
            assert.strictEqual(result?.number, 12);
            assert.strictEqual(result?.title, 'Draft update');
            assert.strictEqual(result?.body, 'Body v2');
            assert.strictEqual(result?.draft, true);
        } finally { mock.close(); }
    });

    it('findOpenPr returns PrResult when MR exists', async () => {
        const mock = await mockGlServer(200, [{ iid: 7, web_url: 'https://gitlab.com/g/r/-/merge_requests/7', title: 'Existing MR', description: 'Body v1', draft: false }]);
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.findOpenPr({ owner: 'g', repo: 'r', head: 'feat', token: 'tok' });
            assert.strictEqual(result?.number, 7);
            assert.strictEqual(result?.title, 'Existing MR');
            assert.strictEqual(result?.body, 'Body v1');
            assert.strictEqual(result?.draft, false);
        } finally { mock.close(); }
    });

    it('updatePr returns updated url on 200', async () => {
        const mock = await mockGlServer(200, { iid: 5, web_url: 'https://gitlab.com/g/r/-/merge_requests/5' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.updatePr({ owner: 'g', repo: 'r', title: 'New', body: 'B', head: 'feat', base: 'main', token: 'tok', number: 5 });
            assert.strictEqual(result.number, 5);
        } finally { mock.close(); }
    });

    it('postPrComment returns a url with the note id', async () => {
        const mock = await mockGlServer(201, { id: 99, noteable_iid: 5 });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.postPrComment({ owner: 'g', repo: 'r', number: 5, body: 'LGTM' });
            assert.ok(result.url.includes('99'));
        } finally { mock.close(); }
    });

    it('replyToReviewThread, resolveReviewThread, and reopenReviewThread work for GitHub', async () => {
        const server = await mockApiServer((req) => {
            const payload = req.body ? JSON.parse(req.body) as { query?: string } : {};
            if (req.method === 'POST' && req.path === '/graphql' && payload.query?.includes('addPullRequestReviewThreadReply')) {
                return { statusCode: 200, body: { data: { addPullRequestReviewThreadReply: { comment: { url: 'https://github.com/o/r/pull/4#discussion_r9' } } } } };
            }
            if (req.method === 'POST' && req.path === '/graphql' && payload.query?.includes('resolveReviewThread')) {
                return { statusCode: 200, body: { data: { resolveReviewThread: { thread: { id: 'thread-1' } } } } };
            }
            if (req.method === 'POST' && req.path === '/graphql' && payload.query?.includes('unresolveReviewThread')) {
                return { statusCode: 200, body: { data: { unresolveReviewThread: { thread: { id: 'thread-1' } } } } };
            }
            return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
        });
        try {
            const provider = new GitHubScmProvider('tok', server.url);
            const reply = await provider.replyToReviewThread({ owner: 'g', repo: 'r', number: 4, threadId: 'thread-1', body: 'Reply body' });
            assert.strictEqual(reply.url, 'https://github.com/o/r/pull/4#discussion_r9');
            assert.deepStrictEqual(await provider.resolveReviewThread({ owner: 'g', repo: 'r', number: 4, threadId: 'thread-1' }), { state: 'resolved' });
            assert.deepStrictEqual(await provider.reopenReviewThread({ owner: 'g', repo: 'r', number: 4, threadId: 'thread-1' }), { state: 'unresolved' });
            assert.ok(server.requests.some(request => request.body.includes('addPullRequestReviewThreadReply')));
            assert.ok(server.requests.some(request => request.body.includes('resolveReviewThread')));
            assert.ok(server.requests.some(request => request.body.includes('unresolveReviewThread')));
        } finally {
            server.close();
        }
    });

    it('replyToReviewThread, resolveReviewThread, and reopenReviewThread work for GitLab', async () => {
        const server = await mockApiServer((req) => {
            if (req.method === 'POST' && req.path === '/projects/g%2Fr/merge_requests/9/discussions/disc-1/notes') {
                return { statusCode: 201, body: { id: 77, web_url: 'https://gitlab.com/o/r/-/merge_requests/9#note_77' } };
            }
            if (req.method === 'PUT' && req.path === '/projects/g%2Fr/merge_requests/9/discussions/disc-1?resolved=true') {
                return { statusCode: 200, body: { id: 'disc-1', resolved: true } };
            }
            if (req.method === 'PUT' && req.path === '/projects/g%2Fr/merge_requests/9/discussions/disc-1?resolved=false') {
                return { statusCode: 200, body: { id: 'disc-1', resolved: false } };
            }
            return { statusCode: 404, body: { message: `unexpected ${req.method} ${req.path}` } };
        });
        try {
            const provider = new GitLabScmProvider('tok', server.url);
            const reply = await provider.replyToReviewThread({ owner: 'g', repo: 'r', number: 9, threadId: 'disc-1', body: 'Reply body' });
            assert.strictEqual(reply.url, 'https://gitlab.com/o/r/-/merge_requests/9#note_77');
            assert.deepStrictEqual(await provider.resolveReviewThread({ owner: 'g', repo: 'r', number: 9, threadId: 'disc-1' }), { state: 'resolved' });
            assert.deepStrictEqual(await provider.reopenReviewThread({ owner: 'g', repo: 'r', number: 9, threadId: 'disc-1' }), { state: 'unresolved' });
            assert.ok(server.requests.some(request => request.path.includes('/discussions/disc-1/notes')));
            assert.ok(server.requests.some(request => request.path.includes('resolved=true')));
            assert.ok(server.requests.some(request => request.path.includes('resolved=false')));
        } finally {
            server.close();
        }
    });

    it('createPr throws with 401 hint on bad credentials', async () => {
        const mock = await mockGlServer(401, { message: 'Unauthorized' });
        try {
            const provider = new GitLabScmProvider('badtoken', mock.url);
            await assert.rejects(
                () => provider.createPr({ owner: 'g', repo: 'r', title: 'T', body: 'B', head: 'feat', base: 'main', token: 'badtoken' }),
                (err: Error) => { assert.ok(err.message.toLowerCase().includes('credentials') || err.message.includes('401') || err.message.includes('Unauthorized')); return true; }
            );
        } finally { mock.close(); }
    });

    it('createPr throws with 404 hint when project not found', async () => {
        const mock = await mockGlServer(404, { message: 'Not Found' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            await assert.rejects(
                () => provider.createPr({ owner: 'ghost', repo: 'missing', title: 'T', body: 'B', head: 'feat', base: 'main', token: 'tok' }),
                (err: Error) => { assert.ok(err.message.includes('404') || err.message.toLowerCase().includes('not found')); return true; }
            );
        } finally { mock.close(); }
    });

    it('updatePr throws on 404', async () => {
        const mock = await mockGlServer(404, { message: 'Merge Request Not Found' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            await assert.rejects(
                () => provider.updatePr({ owner: 'g', repo: 'r', title: 'T', body: 'B', head: 'feat', base: 'main', token: 'tok', number: 999 }),
                (err: Error) => { assert.ok(err.message.includes('404') || err.message.toLowerCase().includes('not found')); return true; }
            );
        } finally { mock.close(); }
    });

    it('findOpenPr returns null when response is not an array', async () => {
        const mock = await mockGlServer(200, { error: 'unexpected' });
        try {
            const provider = new GitLabScmProvider('tok', mock.url);
            const result = await provider.findOpenPr({ owner: 'g', repo: 'r', head: 'feat', token: 'tok' });
            assert.strictEqual(result, null);
        } finally { mock.close(); }
    });
});
