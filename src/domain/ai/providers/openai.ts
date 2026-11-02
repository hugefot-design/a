/**
 * OpenAI (Chat Completions med `response_format: json_schema`, strict). Beholdt som alternativ
 * leverandør; uendret oppførsel fra forrige versjon, men nå med bufrede tokens i kostnaden.
 * IKKE testet mot live API (krever nøkkel).
 */
import { env } from '@/lib/env';
import { AIError, type AIProvider } from '../provider';

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

export function openAIProvider(apiKey: string, model: string): AIProvider {
  return {
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
            { role: 'user', content: req.cacheablePrefix ? `${req.cacheablePrefix}\n\n${req.user}` : req.user },
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
      const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      return {
        data: parsed,
        inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        model: String(data.model ?? model),
        provider: 'openai',
      };
    },
  };
}
