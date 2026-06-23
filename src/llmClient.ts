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
  anthropic:  'claude-opus-4-8',
  openrouter: 'anthropic/claude-opus-4-8',
  groq:       'llama-3.3-70b-versatile',
  ollama:     'llama3.2',
};

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
 * Resolves once the stream completes; rejects with AbortError if cancelled.
 */
export async function chatCompleteStream(
  options: LLMClientOptions,
  messages: LLMMessage[],
  onToken: TokenCallback,
  signal?: AbortSignal
): Promise<void> {
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
): Promise<void> {
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
    max_tokens: 4096,
    stream: true,
  });

  const { statusCode, errorBody } = await streamRequest(url, 'POST', headers, body, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) { return; }
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]' || data === '') { return; }
    try {
      const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { onToken(delta); }
    } catch { /* skip malformed frame */ }
  }, signal);

  if (statusCode < 200 || statusCode >= 300) {
    throw extractApiError(statusCode, errorBody, 'API');
  }
}

async function streamAnthropic(
  options: LLMClientOptions,
  messages: LLMMessage[],
  onToken: TokenCallback,
  signal?: AbortSignal
): Promise<void> {
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
    max_tokens: 4096,
    messages: apiMessages,
    stream: true,
  };
  if (systemMsg) { bodyObj['system'] = systemMsg; }

  const body = JSON.stringify(bodyObj);

  const { statusCode, errorBody } = await streamRequest(url, 'POST', headers, body, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) { return; }
    const data = trimmed.slice(5).trim();
    if (data === '') { return; }
    try {
      const json = JSON.parse(data) as { type?: string; delta?: { text?: string } };
      if (json.type === 'content_block_delta' && json.delta?.text) {
        onToken(json.delta.text);
      }
    } catch { /* skip malformed frame */ }
  }, signal);

  if (statusCode < 200 || statusCode >= 300) {
    throw extractApiError(statusCode, errorBody, 'Anthropic API');
  }
}
