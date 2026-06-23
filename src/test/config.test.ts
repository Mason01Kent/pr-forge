import * as assert from 'assert';
import { migrateConfig } from '../config';

describe('migrateConfig', () => {
  it('sets schemaVersion to 2 when missing', () => {
    const result = migrateConfig({ projectName: 'test' });
    assert.strictEqual(result.schemaVersion, 2);
  });

  it('sets runTestsOnGenerate to true when missing', () => {
    const result = migrateConfig({ schemaVersion: 1 });
    assert.strictEqual(result.runTestsOnGenerate, true);
  });

  it('preserves existing schemaVersion 2 fields', () => {
    const result = migrateConfig({ schemaVersion: 2, runTestsOnGenerate: false });
    assert.strictEqual(result.schemaVersion, 2);
    assert.strictEqual(result.runTestsOnGenerate, false);
  });

  it('does not overwrite explicit runTestsOnGenerate: false on v1 config', () => {
    // A v1 config that had runTestsOnGenerate: false explicitly set should keep it
    const result = migrateConfig({ schemaVersion: 1, runTestsOnGenerate: false });
    assert.strictEqual(result.runTestsOnGenerate, false);
  });

  it('passes through all other fields unchanged', () => {
    const result = migrateConfig({
      schemaVersion: 2,
      projectName: 'my-app',
      baseBranch: 'develop',
      provider: 'anthropic',
    });
    assert.strictEqual(result.projectName, 'my-app');
    assert.strictEqual(result.baseBranch, 'develop');
    assert.strictEqual(result.provider, 'anthropic');
  });
});
