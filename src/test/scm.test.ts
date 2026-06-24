import * as assert from 'assert';
import { parseRemote } from '../scm';

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
});
