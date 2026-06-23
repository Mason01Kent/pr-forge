import * as https from 'https';
import * as http from 'http';

export interface LLMClientOptions {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Called with each incremental text delta as it streams in. */
export type TokenCallback = (delta: string) => void;

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD, or undefined if the model has no price entry. */
  estimatedCostUsd?: number;
}

/** Price per 1M tokens in USD — [input, output]. Updated to current public pricing. */
const PRICE_PER_1M: Record<string, [number, number]> = {
  'claude-sonnet-4-6':           [3.00,  15.00],
  'claude-opus-4-8':             [15.00, 75.00],
  'claude-haiku-4-5-20251001':   [0.80,   4.00],
  'gpt-4o':                      [2.50,  10.00],
  'gpt-4o-mini':                 [0.15,   0.60],
  'gpt-4-turbo':                 [10.00, 30.00],
  'deepseek-chat':               [0.27,   1.10],
  'deepseek-reasoner':           [0.55,   2.19],
  'llama-3.3-70b-versatile':     [0.59,   0.79],
  'llama-3.1-8b-instant':        [0.05,   0.08],
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = PRICE_PER_1M[model];
  if (!price) { return undefined; }
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

export const PROVIDERS: Record<string, { displayName: string; baseUrl: string; noAuth: boolean }> = {
  deepseek:   { displayName: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',         noAuth: false },
  openai:     { displayName: 'OpenAI',     baseUrl: 'https://api.openai.com',            noAuth: false },
  anthropic:  { displayName: 'Anthropic',  baseUrl: 'https://api.anthropic.com',         noAuth: false },
  openrouter: { displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api',         noAuth: false },
  groq:       { displayName: 'Groq',       baseUrl: 'https://api.groq.com/openai',       noAuth: false },
  ollama:     { displayName: 'Ollama (local)', baseUrl: 'http://localhost:11434',         noAuth: true  },
};

export const DEFAULT_MODELS: Record<string, string> = {
  deepseek:   'deepseek-chat',
  openai:     'gpt-4o',
  anthropic:  'claude-sonnet-4-6',
  openrouter: 'anthropic/claude-sonnet-4-6',
  groq:       'llama-3.3-70b-versatile',
  ollama:     'llama3.2',
};

/**
 * Context window (chars, not tokens; 1 token ≈ 4 chars) and max output tokens
 * per model family. Used to decide whether to pass the full diff or summarise.
 * Conservative estimates — err on the side of fitting rather than over-filling.
 */
export interface ModelLimits {
  /** Usable input budget in characters (context window minus output headroom). */
  inputBudgetChars: number;
  maxOutputTokens: number;
}

export const MODEL_LIMITS: Record<string, ModelLimits> = {
  // Anthropic Claude — 200k token context
  'claude-opus-4-8':        { inputBudgetChars: 600_000, maxOutputTokens: 8192 },
  'claude-sonnet-4-6':      { inputBudgetChars: 600_000, maxOutputTokens: 8192 },
  'claude-haiku-4-5-20251001': { inputBudgetChars: 600_000, maxOutputTokens: 8192 },
  // OpenAI — 128k token context
  'gpt-4o':                 { inputBudgetChars: 400_000, maxOutputTokens: 16384 },
  'gpt-4o-mini':            { inputBudgetChars: 400_000, maxOutputTokens: 16384 },
  'gpt-4-turbo':            { inputBudgetChars: 400_000, maxOutputTokens: 4096 },
  // DeepSeek — 128k token context
  'deepseek-chat':          { inputBudgetChars: 400_000, maxOutputTokens: 8192 },
  'deepseek-reasoner':      { inputBudgetChars: 400_000, maxOutputTokens: 8192 },
  // Groq — varies by model; use 32k as safe default
  'llama-3.3-70b-versatile': { inputBudgetChars: 100_000, maxOutputTokens: 8192 },
  'llama-3.1-8b-instant':   { inputBudgetChars: 100_000, maxOutputTokens: 8192 },
  // Ollama — conservative default (model-dependent)
  'llama3.2':               { inputBudgetChars: 100_000, maxOutputTokens: 4096 },
  'llama3.1':               { inputBudgetChars: 100_000, maxOutputTokens: 4096 },
  'mistral':                { inputBudgetChars: 100_000, maxOutputTokens: 4096 },
};

/** Default limits for unknown models. */
const DEFAULT_LIMITS: ModelLimits = { inputBudgetChars: 80_000, maxOutputTokens: 4096 };

export function getModelLimits(model: string): ModelLimits {
  if (MODEL_LIMITS[model]) { return MODEL_LIMITS[model]; }
  // Match by prefix (e.g. "claude-" → large context, "gpt-4" → large)
  if (model.startsWith('claude-'))    { return { inputBudgetChars: 600_000, maxOutputTokens: 8192 }; }
  if (model.startsWith('gpt-4'))      { return { inputBudgetChars: 400_000, maxOutputTokens: 8192 }; }
  if (model.startsWith('gpt-3.5'))    { return { inputBudgetChars:  60_000, maxOutputTokens: 4096 }; }
  if (model.startsWith('deepseek-'))  { return { inputBudgetChars: 400_000, maxOutputTokens: 8192 }; }
  return DEFAULT_LIMITS;
}

/** Static curated model list for providers that don't have a /models endpoint. */
export const STATIC_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-haiku-4-5-20251001',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
  ],
  openrouter: [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-8',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.3-70b-instruct',
  ],
};

/**
 * List available models for a provider.
 * Returns a static curated list for providers without a /models endpoint.
 * Falls back to the static list on any network error.
 */
export async function listModels(options: LLMClientOptions): Promise<string[]> {
  const staticList = STATIC_MODELS[options.provider];

  if (options.provider === 'anthropic') {
    return staticList ?? [DEFAULT_MODELS.anthropic];
  }

  if (options.provider === 'ollama') {
    try {
      const baseUrl = options.baseUrl || PROVIDERS.ollama.baseUrl;
      const res = await fetchJson(`${baseUrl}/api/tags`);
      const models = (res as { models?: { name?: string }[] }).models;
      if (Array.isArray(models) && models.length > 0) {
        return models.map((m) => m.name ?? '').filter(Boolean);
      }
    } catch { /* fall through */ }
    return [DEFAULT_MODELS.ollama];
  }

  // OpenAI-compatible providers (openai, deepseek, groq, openrouter)
  // Try live API first, fall back to static list on error or no results
  try {
    const baseUrl = options.baseUrl || PROVIDERS[options.provider]?.baseUrl || '';
    const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
    const headers: Record<string, string> = { 'Authorization': `Bearer ${options.apiKey}` };
    const res = await fetchJson(url, headers);
    const data = (res as { data?: { id?: string }[] }).data;
    if (Array.isArray(data) && data.length > 0) {
      return data.map((m) => m.id ?? '').filter(Boolean).sort();
    }
  } catch { /* fall through */ }
  return staticList ?? [DEFAULT_MODELS[options.provider] ?? ''];
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'http:' ? http : https;
    const opts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: { 'Accept': 'application/json', ...headers },
    };
    const req = mod.request(opts, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (c: string) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Thrown when a request is cancelled via AbortSignal. */
export class AbortError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'AbortError';
  }
}

/**
 * Stream an HTTP request. `onLine` is called for every complete line in a
 * successful (2xx) response body; on a non-2xx response the full body is
 * buffered and returned as `errorBody`. Honours an optional AbortSignal.
 */
function streamRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<{ statusCode: number; errorBody?: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'http:' ? http : https;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
    };

    const req = mod.request(options, (res) => {
      const statusCode = res.statusCode ?? 0;
      res.setEncoding('utf-8');

      // Non-2xx: buffer the whole body so the caller can extract an error message.
      if (statusCode < 200 || statusCode >= 300) {
        let errBuf = '';
        res.on('data', (chunk: string) => { errBuf += chunk; });
        res.on('end', () => resolve({ statusCode, errorBody: errBuf }));
        return;
      }

      let buffer = '';
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          onLine(line);
        }
      });
      res.on('end', () => {
        if (buffer.length > 0) { onLine(buffer); }
        resolve({ statusCode });
      });
    });

    if (signal) {
      const onAbort = () => req.destroy(new AbortError());
      if (signal.aborted) { onAbort(); }
      else { signal.addEventListener('abort', onAbort, { once: true }); }
    }

    req.on('error', (err: Error) => {
      if (err instanceof AbortError || (signal?.aborted)) {
        reject(new AbortError());
      } else {
        reject(new Error(`Request failed: ${err.message}`));
      }
    });
    req.write(body);
    req.end();
  });
}

function extractApiError(statusCode: number, raw: string | undefined, label: string): Error {
  if (!raw) { return new Error(`${label} error ${statusCode}`); }
  let errorJson: { error?: { message?: string }; message?: string };
  try {
    errorJson = JSON.parse(raw);
  } catch {
    return new Error(`${label} error ${statusCode}`);
  }
  return new Error(errorJson.error?.message || errorJson.message || `${label} error ${statusCode}`);
}

/**
 * Non-streaming convenience wrapper — accumulates the streamed deltas and
 * returns the full text. Existing callers keep working unchanged.
 */
export async function chatComplete(
  options: LLMClientOptions,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<string> {
  let full = '';
  await chatCompleteStream(options, messages, (delta) => { full += delta; }, signal);
  return full;
}

/**
 * Stream a chat completion, invoking `onToken` for each text delta.
 * Resolves with UsageStats once the stream completes.
 * Rejects with AbortError if cancelled.
 */
export async function chatCompleteStream(
  options: LLMClientOptions,
  messages: LLMMessage[],
  onToken: TokenCallback,
  signal?: AbortSignal
): Promise<UsageStats> {
  const baseUrl = options.baseUrl || PROVIDERS[options.provider]?.baseUrl;
  if (!baseUrl) {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  if (options.provider === 'anthropic') {
    return streamAnthropic(options, messages, onToken, signal);
  }
  return streamOpenAICompatible(options, messages, baseUrl, onToken, signal);
}

async function streamOpenAICompatible(
  options: LLMClientOptions,
  messages: LLMMessage[],
  baseUrl: string,
  onToken: TokenCallback,
  signal?: AbortSignal
): Promise<UsageStats> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.provider !== 'ollama') {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }
  if (options.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'pr-forge';
  }

  const body = JSON.stringify({
    model: options.model,
    messages,
    temperature: 0.3,
    max_tokens: getModelLimits(options.model).maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  });

  let inputTokens = 0;
  let outputTokens = 0;

  const { statusCode, errorBody } = await streamRequest(url, 'POST', headers, body, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) { return; }
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]' || data === '') { return; }
    try {
      const json = JSON.parse(data) as {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { onToken(delta); }
      if (json.usage) {
        inputTokens  = json.usage.prompt_tokens     ?? inputTokens;
        outputTokens = json.usage.completion_tokens ?? outputTokens;
      }
    } catch { /* skip malformed frame */ }
  }, signal);

  if (statusCode < 200 || statusCode >= 300) {
    throw extractApiError(statusCode, errorBody, 'API');
  }
  return { inputTokens, outputTokens, estimatedCostUsd: calcCost(options.model, inputTokens, outputTokens) };
}

async function streamAnthropic(
  options: LLMClientOptions,
  messages: LLMMessage[],
  onToken: TokenCallback,
  signal?: AbortSignal
): Promise<UsageStats> {
  const url = 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'x-api-key': options.apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  let systemMsg: string | undefined;
  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' && !systemMsg) {
      systemMsg = msg.content;
    } else {
      apiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }
  }

  const bodyObj: Record<string, unknown> = {
    model: options.model,
    max_tokens: getModelLimits(options.model).maxOutputTokens,
    messages: apiMessages,
    stream: true,
  };
  if (systemMsg) { bodyObj['system'] = systemMsg; }

  const body = JSON.stringify(bodyObj);

  let inputTokens = 0;
  let outputTokens = 0;

  const { statusCode, errorBody } = await streamRequest(url, 'POST', headers, body, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) { return; }
    const data = trimmed.slice(5).trim();
    if (data === '') { return; }
    try {
      const json = JSON.parse(data) as {
        type?: string;
        delta?: { text?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      };
      if (json.type === 'content_block_delta' && json.delta?.text) {
        onToken(json.delta.text);
      }
      // Anthropic emits usage in message_start and message_delta events
      const u = json.usage ?? json.message?.usage;
      if (u) {
        if (u.input_tokens  !== undefined) { inputTokens  = u.input_tokens; }
        if (u.output_tokens !== undefined) { outputTokens = u.output_tokens; }
      }
    } catch { /* skip malformed frame */ }
  }, signal);

  if (statusCode < 200 || statusCode >= 300) {
    throw extractApiError(statusCode, errorBody, 'Anthropic API');
  }
  return { inputTokens, outputTokens, estimatedCostUsd: calcCost(options.model, inputTokens, outputTokens) };
}
