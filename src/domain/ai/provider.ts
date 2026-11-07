/**
 * Leverandøruavhengig AI-lag. Støtter Anthropic (offisiell SDK) og OpenAI (HTTP), og en
 * mock-leverandør som KUN er tillatt i utvikling og test.
 *
 * Alle kall ber om strukturert JSON etter et skjema, og svaret valideres med zod før lagring.
 *
 * Modellvalg etter oppgave (kostnad mot kvalitet):
 *  - 'quality': full anbudsanalyse, egnethetsvurdering og tilbudstekst – her teller presisjon.
 *  - 'fast':    korte sammendrag og ukesoversikt – en billig modell holder.
 * Er det ikke satt en egen rask modell, brukes kvalitetsmodellen til alt.
 */
import { env } from '@/lib/env';
import { anthropicProvider } from './providers/anthropic';
import { openAIProvider } from './providers/openai';

export type JsonSchema = Record<string, unknown>;
export type ModelTier = 'fast' | 'quality';
export type Effort = 'low' | 'medium' | 'high';

export interface StructuredRequest {
  system: string;
  /**
   * Lang og stabil tekst (kildene) som kommer først i forespørselen. Leverandører som støtter
   * det, bufrer den (prompt caching), slik at flere spørsmål om samme anbud koster mindre.
   */
  cacheablePrefix?: string;
  user: string;
  schemaName: string;
  schemaDescription: string;
  schema: JsonSchema;
  maxOutputTokens: number;
  /** Hvor grundig modellen skal tenke. Lavere = raskere og billigere. */
  effort?: Effort;
  /** Brukes av mock-leverandøren for å lage forutsigbare svar. */
  mockHint?: unknown;
}

export interface StructuredResponse {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
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

/** Mock: lager forutsigbare svar fra mockHint. Nekter å kjøre i produksjon. */
export const mockProvider: AIProvider = {
  name: 'mock',
  model: 'mock-1',
  async generate(req) {
    if (env.NODE_ENV === 'production') throw new AIError('Mock-leverandøren kan ikke brukes i produksjon.');
    const data = typeof req.mockHint === 'function' ? (req.mockHint as () => unknown)() : (req.mockHint ?? {});
    const inputTokens = Math.ceil(((req.cacheablePrefix ?? '').length + req.user.length) / 4);
    return { data, inputTokens, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'mock-1', provider: 'mock' };
  },
};

let override: AIProvider | null = null;
/** Brukes i tester for å simulere feil eller spesifikke svar. */
export function setProviderOverride(p: AIProvider | null): void {
  override = p;
}

export function modelFor(tier: ModelTier): string | null {
  switch (env.AI_PROVIDER) {
    case 'openai':
      return (tier === 'fast' ? env.OPENAI_MODEL_FAST : null) ?? env.OPENAI_MODEL ?? null;
    case 'anthropic':
      return (tier === 'fast' ? env.ANTHROPIC_MODEL_FAST : null) ?? env.ANTHROPIC_MODEL ?? null;
    case 'mock':
      return 'mock-1';
    default:
      return null;
  }
}

/**
 * AI for en organisasjon. Ekte AI når leverandøren er satt opp. Ellers kjører organisasjoner med
 * admin-tilgang i testmodus (simulerte svar, tydelig merket), så administratoren kan se hvordan
 * AI-funksjonene virker uten nøkkel og uten kostnad. For alle andre er AI av.
 */
export function aiFor(org: { adminAccess?: boolean } | null | undefined, tier: ModelTier = 'quality'): { provider: AIProvider | null; demo: boolean } {
  const real = getProvider(tier);
  if (real) return { provider: real, demo: false };
  if (org?.adminAccess) return { provider: mockProvider, demo: true };
  return { provider: null, demo: false };
}

/** Til sidene: er AI tilgjengelig for organisasjonen, og er svarene simulerte? */
export function aiModeFor(org: { adminAccess?: boolean } | null | undefined): { configured: boolean; isMock: boolean } {
  const { provider, demo } = aiFor(org);
  return { configured: provider !== null, isMock: demo || provider?.name === 'mock' };
}

export function getProvider(tier: ModelTier = 'quality'): AIProvider | null {
  if (override) return override;
  const model = modelFor(tier);
  switch (env.AI_PROVIDER) {
    case 'openai':
      return env.OPENAI_API_KEY && model ? openAIProvider(env.OPENAI_API_KEY, model) : null;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY && model ? anthropicProvider(env.ANTHROPIC_API_KEY, model) : null;
    case 'mock':
      return mockProvider;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Kostnad
// ---------------------------------------------------------------------------
export interface ModelPrice {
  /** USD per million tokens */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Høyere pris når hele forespørselen (inn + bufret) er over en grense (Haiku 5.5: 100 000 tokens). */
  longContext?: { thresholdTokens: number; price: Omit<ModelPrice, 'longContext'> };
}

/**
 * Listepriser fra Anthropic (kontrollert mot platform.claude.com/docs/en/about-claude/pricing 2.11.2026,
 * standard API). Cache-skriving (5 min) er 1,25 × inn-pris. Cache-lesing er 0,05 × for Sonnet 5.5 og
 * Opus 5.5, og 0,1 × for Haiku 5.5. Haiku 5.5 har høyere pris over 100 000 tokens per forespørsel.
 * Kontroller prisene før lansering – miljøvariablene AI_*_PRICE_PER_MTOK_USD overstyrer tabellen.
 */
export const KNOWN_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longContext: { thresholdTokens: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export function priceFor(model: string): ModelPrice {
  const isFast = model === (env.ANTHROPIC_MODEL_FAST ?? env.OPENAI_MODEL_FAST) && model !== (env.ANTHROPIC_MODEL ?? env.OPENAI_MODEL);
  const envInput = isFast ? env.AI_FAST_INPUT_PRICE_PER_MTOK_USD : env.AI_INPUT_PRICE_PER_MTOK_USD;
  const envOutput = isFast ? env.AI_FAST_OUTPUT_PRICE_PER_MTOK_USD : env.AI_OUTPUT_PRICE_PER_MTOK_USD;
  const known = KNOWN_MODEL_PRICES[model];
  if (envInput > 0 || envOutput > 0) {
    return { input: envInput, output: envOutput, cacheRead: envInput * 0.1, cacheWrite: envInput * 1.25 };
  }
  return known ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): number {
  const base = priceFor(model);
  const promptTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const p = base.longContext && promptTokens > base.longContext.thresholdTokens ? base.longContext.price : base;
  return (
    (usage.inputTokens * p.input + usage.outputTokens * p.output + (usage.cacheReadTokens ?? 0) * p.cacheRead + (usage.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}
