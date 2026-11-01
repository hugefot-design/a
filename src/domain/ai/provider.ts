/**
 * Leverandøruavhengig AI-lag. Støtter OpenAI og Anthropic via HTTP (ingen SDK-avhengighet),
 * og en mock-leverandør som KUN er tillatt i utvikling og test.
 *
 * Alle kall ber om strukturert JSON etter et skjema, og svaret valideres med zod før lagring.
 */
import { env } from '@/lib/env';

export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  system: string;
  user: string;
  schemaName: string;
  schemaDescription: string;
  schema: JsonSchema;
  maxOutputTokens: number;
  /** Brukes av mock-leverandøren for å lage forutsigbare svar. */
  mockHint?: unknown;
}

export interface StructuredResponse {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: 'openai' | 'anthropic' | 'mock';
}

export interface AIProvider {
  name: 'openai' | 'anthropic' | 'mock';
  model: string;
  generate(req: StructuredRequest): Promise<StructuredResponse>;
}

export class AIError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AIError(`Kunne ikke nå AI-leverandøren: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new AIError(`AI-leverandøren svarte med feil: ${message}`, res.status === 429 || res.status >= 500);
  }
  return data;
}

export const openAIProvider = (apiKey: string, model: string): AIProvider => ({
  name: 'openai',
  model,
  async generate(req) {
    const data = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        max_completion_tokens: req.maxOutputTokens,
      },
    );
    const choice = (data.choices as { message?: { content?: string; refusal?: string } }[] | undefined)?.[0]?.message;
    if (choice?.refusal) throw new AIError(`AI-leverandøren avviste forespørselen: ${choice.refusal}`);
    if (!choice?.content) throw new AIError('Tomt svar fra AI-leverandøren.', true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(choice.content);
    } catch {
      throw new AIError('AI-svaret var ikke gyldig JSON.', true);
    }
    const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    return {
      data: parsed,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      model: String(data.model ?? model),
      provider: 'openai',
    };
  },
});

export const anthropicProvider = (apiKey: string, model: string): AIProvider => ({
  name: 'anthropic',
  model,
  async generate(req) {
    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [{ name: req.schemaName, description: req.schemaDescription, input_schema: req.schema }],
        tool_choice: { type: 'tool', name: req.schemaName },
      },
    );
    const content = (data.content as { type: string; name?: string; input?: unknown }[] | undefined) ?? [];
    const tool = content.find((c) => c.type === 'tool_use' && c.name === req.schemaName);
    if (!tool?.input) throw new AIError('AI-svaret manglet strukturert innhold.', true);
    const usage = (data.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
    return {
      data: tool.input,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      model: String(data.model ?? model),
      provider: 'anthropic',
    };
  },
});

/** Mock: lager forutsigbare svar fra mockHint. Nekter å kjøre i produksjon. */
export const mockProvider: AIProvider = {
  name: 'mock',
  model: 'mock-1',
  async generate(req) {
    if (env.NODE_ENV === 'production') throw new AIError('Mock-leverandøren kan ikke brukes i produksjon.');
    if (typeof req.mockHint === 'function') {
      return { data: (req.mockHint as () => unknown)(), inputTokens: Math.ceil(req.user.length / 4), outputTokens: 400, model: 'mock-1', provider: 'mock' };
    }
    return { data: req.mockHint ?? {}, inputTokens: Math.ceil(req.user.length / 4), outputTokens: 400, model: 'mock-1', provider: 'mock' };
  },
};

let override: AIProvider | null = null;
/** Brukes i tester for å simulere feil eller spesifikke svar. */
export function setProviderOverride(p: AIProvider | null): void {
  override = p;
}

export function getProvider(): AIProvider | null {
  if (override) return override;
  switch (env.AI_PROVIDER) {
    case 'openai':
      return env.OPENAI_API_KEY && env.OPENAI_MODEL ? openAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL) : null;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL ? anthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL) : null;
    case 'mock':
      return mockProvider;
    default:
      return null;
  }
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * env.AI_INPUT_PRICE_PER_MTOK_USD + outputTokens * env.AI_OUTPUT_PRICE_PER_MTOK_USD) / 1_000_000;
}
