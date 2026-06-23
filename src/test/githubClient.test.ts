import * as assert from 'assert';
import { parseGitHubRemote } from '../githubClient';

describe('parseGitHubRemote', () => {
  it('parses HTTPS URL with .git suffix', () => {
    const result = parseGitHubRemote('https://github.com/owner/repo.git');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  it('parses HTTPS URL without .git suffix', () => {
    const result = parseGitHubRemote('https://github.com/owner/repo');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  it('parses SSH URL', () => {
    const result = parseGitHubRemote('git@github.com:owner/repo.git');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  it('parses SSH URL without .git suffix', () => {
    const result = parseGitHubRemote('git@github.com:owner/repo');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  it('returns null for non-GitHub URL', () => {
    assert.strictEqual(parseGitHubRemote('https://gitlab.com/owner/repo.git'), null);
  });

  it('returns null for malformed URL', () => {
    assert.strictEqual(parseGitHubRemote('not-a-url'), null);
  });

  it('handles org with hyphens and underscores', () => {
    const result = parseGitHubRemote('https://github.com/my-org_name/my-repo_name.git');
    assert.deepStrictEqual(result, { owner: 'my-org_name', repo: 'my-repo_name' });
  });
});
