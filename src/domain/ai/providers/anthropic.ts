/**
 * Anthropic (Claude) via den offisielle SDK-en.
 *
 * - Strukturert JSON med `output_config.format` (json_schema). Tvunget verktøybruk (`tool_choice`
 *   tool/any) avvises med HTTP 400 på Claude Sonnet 5.5 / Opus 5.5, så det brukes ikke.
 * - `output_config.effort` styrer hvor grundig modellen tenker (og dermed kostnaden).
 * - Kildeteksten sendes først med `cache_control`, slik at flere spørsmål om samme anbud innen
 *   fem minutter leser den fra Anthropics hurtigbuffer (ca. 10 % av vanlig pris).
 * - Hvis modellens sikkerhetsfilter avslår (f.eks. et anbud om penetrasjonstesting), prøver
 *   Anthropic automatisk en annen modell (`fallbacks: "default"`) på modellene som støtter det.
 *   Avslag som består, gir en tydelig feilmelding – aldri et tomt eller oppdiktet svar.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { AIError, type AIProvider, type StructuredRequest } from '../provider';

/** Modeller med serverbasert reserve-modell ved avslag (Claude API). Haiku 5.5 har det ikke. */
const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.APIConnectionError) return new AIError(`Kunne ikke nå Anthropic: ${err.message}`, true);
  if (err instanceof Anthropic.RateLimitError) return new AIError('Anthropic har midlertidig for mange forespørsler.', true);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError('Anthropic avviste API-nøkkelen. Administrator må sjekke ANTHROPIC_API_KEY.', false);
  }
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Anthropic avviste forespørselen: ${err.message}`, false);
  if (err instanceof Anthropic.APIError) return new AIError(`Anthropic svarte med feil (${err.status ?? 'ukjent'}).`, (err.status ?? 500) >= 500);
  return new AIError(`Ukjent feil fra Anthropic: ${err instanceof Error ? err.message : String(err)}`, true);
}

export function anthropicProvider(apiKey: string, model: string): AIProvider {
  const client = new Anthropic({ apiKey, baseURL: env.ANTHROPIC_API_BASE_URL, timeout: env.AI_TIMEOUT_MS, maxRetries: 2 });
  return {
    name: 'anthropic',
    model,
    async generate(req: StructuredRequest) {
      const content: Anthropic.TextBlockParam[] = [];
      if (req.cacheablePrefix) content.push({ type: 'text', text: req.cacheablePrefix, cache_control: { type: 'ephemeral' } });
      content.push({ type: 'text', text: req.user });
      const params = {
        model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user' as const, content }],
        output_config: {
          effort: req.effort ?? 'medium',
          format: { type: 'json_schema' as const, schema: req.schema },
        },
      };
      let response: Anthropic.Message | Anthropic.Beta.BetaMessage;
      try {
        response = SERVER_FALLBACK_MODELS.has(model)
          ? await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
          : await client.messages.create(params);
      } catch (err) {
        throw toAIError(err);
      }
      if (response.stop_reason === 'refusal') {
        throw new AIError('AI-modellen avslo å behandle denne teksten (sikkerhetsfilter hos leverandøren). Les kunngjøringen direkte hos kilden.', false);
      }
      if (response.stop_reason === 'max_tokens') throw new AIError('AI-svaret ble for langt og ble avbrutt.', true);
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (!text.trim()) throw new AIError('Tomt svar fra AI-leverandøren.', true);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AIError('AI-svaret var ikke gyldig JSON.', true);
      }
      const usage = response.usage;
      return {
        data,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        // Ved reserve-modell står modellen som faktisk svarte, i svaret.
        model: response.model ?? model,
        provider: 'anthropic' as const,
      };
    },
  };
}
