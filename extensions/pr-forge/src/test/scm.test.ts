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

  it('rejects GitLab HTTPS remotes (GitHub-only in 1.0)', () => {
    assert.strictEqual(parseRemote('https://gitlab.com/group/repo.git', 'token'), null);
  });

  it('rejects GitLab SSH remotes (GitHub-only in 1.0)', () => {
    assert.strictEqual(parseRemote('git@gitlab.com:group/repo.git', 'token'), null);
  });

  it('returns null for unsupported remotes', () => {
    assert.strictEqual(parseRemote('https://bitbucket.org/owner/repo.git', 'token'), null);
  });
});
