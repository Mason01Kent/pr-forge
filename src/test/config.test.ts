import * as assert from 'assert';
import { migrateConfig } from '../config';

describe('migrateConfig', () => {
  it('sets schemaVersion to the latest when missing', () => {
    const result = migrateConfig({ projectName: 'test' });
    assert.strictEqual(result.schemaVersion, 6);
  });

  it('sets includeCommitSummaries to false when missing', () => {
    const result = migrateConfig({ schemaVersion: 3 });
    assert.strictEqual(result.includeCommitSummaries, false);
    assert.strictEqual(result.schemaVersion, 6);
  });

  it('sets includeFileWalkthrough and reReviewOnPush to false when upgrading to v5', () => {
    const result = migrateConfig({ schemaVersion: 4 });
    assert.strictEqual(result.includeFileWalkthrough, false);
    assert.strictEqual(result.reReviewOnPush, false);
    assert.strictEqual(result.schemaVersion, 6);
  });

  it('sets runTestsOnGenerate to true when missing', () => {
    const result = migrateConfig({ schemaVersion: 1 });
    assert.strictEqual(result.runTestsOnGenerate, true);
  });

  it('sets includeRecentCommits to false when missing', () => {
    const result = migrateConfig({ schemaVersion: 2 });
    assert.strictEqual(result.includeRecentCommits, false);
  });

  it('preserves existing fields while upgrading the schema', () => {
    const result = migrateConfig({ schemaVersion: 2, runTestsOnGenerate: false });
    assert.strictEqual(result.schemaVersion, 6);
    assert.strictEqual(result.runTestsOnGenerate, false);
  });

  it('does not overwrite explicit runTestsOnGenerate: false on v1 config', () => {
    // A v1 config that had runTestsOnGenerate: false explicitly set should keep it
    const result = migrateConfig({ schemaVersion: 1, runTestsOnGenerate: false });
    assert.strictEqual(result.runTestsOnGenerate, false);
  });

  it('passes through all other fields unchanged', () => {
    const result = migrateConfig({
      schemaVersion: 3,
      projectName: 'my-app',
      baseBranch: 'develop',
      provider: 'anthropic',
      includeRecentCommits: true,
    });
    assert.strictEqual(result.projectName, 'my-app');
    assert.strictEqual(result.baseBranch, 'develop');
    assert.strictEqual(result.provider, 'anthropic');
    assert.strictEqual(result.includeRecentCommits, true);
  });

  it('sets schemaVersion to 6 on a fresh config', () => {
    const result = migrateConfig({});
    assert.strictEqual(result.schemaVersion, 6);
  });

  it('upgrades a v5 config to schemaVersion 6', () => {
    const result = migrateConfig({ schemaVersion: 5 });
    assert.strictEqual(result.schemaVersion, 6);
  });
});
