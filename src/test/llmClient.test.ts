import * as assert from 'assert';
import * as http from 'http';
import { getModelLimits, DEFAULT_MODELS } from '../llmClient';
import { listModels } from '../llmClient';

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

describe('listModels', () => {
  it('returns models from an OpenAI-compatible /v1/models endpoint', async () => {
    const server = await new Promise<{ url: string; close: () => void }>((resolve) => {
      const httpServer = http.createServer((_req, res) => {
        const body = JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() });
        res.end(body);
      });
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address() as { port: number };
        resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => httpServer.close() });
      });
    });

    try {
      const models = await listModels({ provider: 'openai', apiKey: 'tok', model: 'gpt-4o', baseUrl: server.url });
      assert.deepStrictEqual(models, ['model-a', 'model-b']);
    } finally {
      server.close();
    }
  });

  it('falls back to the static curated list when the endpoint fails', async () => {
    const models = await listModels({ provider: 'deepseek', apiKey: 'tok', model: 'deepseek-chat', baseUrl: 'http://127.0.0.1:1' });
    assert.ok(models.includes('deepseek-chat'));
    assert.ok(models.includes('deepseek-reasoner'));
  });
});
