import * as assert from 'assert';
import { getModelLimits, DEFAULT_MODELS } from '../llmClient';

describe('getModelLimits', () => {
  it('returns large budget for claude-sonnet-4-6', () => {
    const limits = getModelLimits('claude-sonnet-4-6');
    assert.ok(limits.inputBudgetChars >= 600_000);
    assert.ok(limits.maxOutputTokens >= 8192);
  });

  it('returns large budget for gpt-4o', () => {
    const limits = getModelLimits('gpt-4o');
    assert.ok(limits.inputBudgetChars >= 400_000);
  });

  it('falls back to claude- prefix for unknown claude model', () => {
    const limits = getModelLimits('claude-future-model-99');
    assert.ok(limits.inputBudgetChars >= 600_000);
  });

  it('falls back to gpt-4 prefix for unknown gpt-4 model', () => {
    const limits = getModelLimits('gpt-4-turbo-preview');
    assert.ok(limits.inputBudgetChars >= 400_000);
  });

  it('returns conservative default for completely unknown model', () => {
    const limits = getModelLimits('some-unknown-model-xyz');
    assert.ok(limits.inputBudgetChars > 0);
    assert.ok(limits.maxOutputTokens > 0);
  });

  it('all DEFAULT_MODELS have limits defined', () => {
    for (const model of Object.values(DEFAULT_MODELS)) {
      const limits = getModelLimits(model);
      assert.ok(limits.inputBudgetChars > 0, `no budget for ${model}`);
    }
  });
});
