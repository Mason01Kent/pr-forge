import * as assert from 'assert';
import { parseRemote, GitLabScmProvider } from '../scm';

describe('parseRemote', () => {
  it('parses GitHub HTTPS remotes', () => {
    const result = parseRemote('https://github.com/owner/repo.git', 'token');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitHub');
  });

  it('parses GitHub SSH remotes', () => {
    const result = parseRemote('git@github.com:owner/repo.git', 'token');
    assert.strictEqual(result?.owner, 'owner');
    assert.strictEqual(result?.repo, 'repo');
    assert.strictEqual(result?.provider.name, 'GitHub');
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

  it('returns null for unsupported remotes', () => {
    assert.strictEqual(parseRemote('https://bitbucket.org/owner/repo.git', 'token'), null);
  });

  it('returns a GitHub provider exposing the full SCM interface', () => {
    const result = parseRemote('https://github.com/owner/repo.git', 'token');
    assert.ok(result);
    assert.strictEqual(result!.provider.name, 'GitHub');
    for (const method of ['createPr', 'findOpenPr', 'updatePr', 'postPrComment'] as const) {
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
    for (const method of ['createPr', 'findOpenPr', 'updatePr', 'postPrComment'] as const) {
      assert.strictEqual(typeof provider[method], 'function', `missing ${method}`);
    }
  });
});
