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

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string
): Promise<{ statusCode: number; body: string }> {
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
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
      });
    });
    req.on('error', (err: Error) => reject(new Error(`Request failed: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

export async function chatComplete(options: LLMClientOptions, messages: LLMMessage[]): Promise<string> {
  const baseUrl = options.baseUrl || PROVIDERS[options.provider]?.baseUrl;
  if (!baseUrl) {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  if (options.provider === 'anthropic') {
    return chatCompleteAnthropic(options, messages);
  }

  return chatCompleteOpenAICompatible(options, messages, baseUrl);
}

async function chatCompleteOpenAICompatible(
  options: LLMClientOptions,
  messages: LLMMessage[],
  baseUrl: string
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

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
  });

  const { statusCode, body: responseBody } = await httpRequest(url, 'POST', headers, body);

  if (statusCode >= 200 && statusCode < 300) {
    let json: { choices?: { message?: { content?: string } }[] };
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new Error(`API returned invalid JSON (status ${statusCode})`);
    }
    const content = json.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new Error(`API response missing content (status ${statusCode})`);
    }
    return content;
  }

  let errorJson: { error?: { message?: string }; message?: string };
  try {
    errorJson = JSON.parse(responseBody);
  } catch {
    throw new Error(`API error ${statusCode}`);
  }
  throw new Error(errorJson.error?.message || errorJson.message || `API error ${statusCode}`);
}

async function chatCompleteAnthropic(
  options: LLMClientOptions,
  messages: LLMMessage[]
): Promise<string> {
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
  };
  if (systemMsg) {
    bodyObj['system'] = systemMsg;
  }

  const body = JSON.stringify(bodyObj);
  const { statusCode, body: responseBody } = await httpRequest(url, 'POST', headers, body);

  if (statusCode >= 200 && statusCode < 300) {
    let json: { content?: { text?: string }[] };
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new Error(`Anthropic API returned invalid JSON (status ${statusCode})`);
    }
    const text = json.content?.[0]?.text;
    if (text === undefined || text === null) {
      throw new Error(`Anthropic API response missing content (status ${statusCode})`);
    }
    return text;
  }

  let errorJson: { error?: { message?: string }; message?: string };
  try {
    errorJson = JSON.parse(responseBody);
  } catch {
    throw new Error(`Anthropic API error ${statusCode}`);
  }
  throw new Error(errorJson.error?.message || errorJson.message || `Anthropic API error ${statusCode}`);
}
