/**
 * AI-leverandøren mot et simulert Anthropic-API: riktig forespørsel (strukturert svar, effort,
 * hurtigbuffer for kildene, reserve-modell ved avslag) og riktig feilhåndtering. Ingen ekte kall.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicProvider } from '../../src/domain/ai/providers/anthropic';
import { AIError, estimateCostUsd, KNOWN_MODEL_PRICES } from '../../src/domain/ai/provider';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeAnthropic(reply: Record<string, unknown>, status = 200): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(await req.text()) as Record<string, unknown> });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  }) as typeof fetch;
  return calls;
}

const okReply = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
  ...extra,
});

const request = {
  system: 'Systeminstruks',
  cacheablePrefix: '<kilder>lang kildetekst</kilder>',
  user: 'Analyser kildene.',
  schemaName: 'tender_summary',
  schemaDescription: 'test',
  schema: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } },
  maxOutputTokens: 4000,
  effort: 'low' as const,
};

test('Anthropic: strukturert JSON via output_config, effort og hurtigbuffer – aldri tvunget verktøybruk', async () => {
  const calls = fakeAnthropic(okReply('{"summary":"Kort sammendrag"}'));
  const res = await anthropicProvider('sk-ant-test', 'claude-sonnet-5-5').generate(request);
  assert.deepEqual(res.data, { summary: 'Kort sammendrag' });
  assert.equal(calls.length, 1);
  const { body, headers, url } = calls[0]!;
  assert.match(url, /^https:\/\/api\.anthropic\.com\/v1\/messages/, 'base-URL hentes fra appens konfigurasjon, ikke fra tilfeldige miljøvariabler');
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.tool_choice, undefined, 'tool_choice tool/any gir 400 på Sonnet 5.5');
  assert.equal(body.tools, undefined);
  assert.deepEqual((body.output_config as Record<string, unknown>).format, { type: 'json_schema', schema: request.schema });
  assert.equal((body.output_config as Record<string, unknown>).effort, 'low');
  const content = (body.messages as { content: { text: string; cache_control?: unknown }[] }[])[0]!.content;
  assert.deepEqual(content[0], { type: 'text', text: request.cacheablePrefix, cache_control: { type: 'ephemeral' } });
  assert.equal(content[1]!.text, request.user);
  // Reserve-modell ved avslag på modeller som støtter det (Claude API).
  assert.equal(body.fallbacks, 'default');
  assert.match(headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  assert.equal(headers.get('authorization'), 'Bearer sk-ant-test', 'nøkkelen sendes slik SDK-en gjør det');
  assert.deepEqual([res.inputTokens, res.outputTokens, res.cacheReadTokens], [1200, 800, 9000]);
});

test('Anthropic: Haiku 5.5 sendes uten reserve-modell (støttes ikke der)', async () => {
  const calls = fakeAnthropic(okReply('{"summary":"x"}', { model: 'claude-haiku-5-5' }));
  await anthropicProvider('sk-ant-test', 'claude-haiku-5-5').generate(request);
  assert.equal(calls[0]!.body.fallbacks, undefined);
  assert.doesNotMatch(calls[0]!.headers.get('anthropic-beta') ?? '', /server-side-fallback/);
});

test('Anthropic: avslag, avkuttet svar og ugyldig JSON gir tydelige feil – aldri et tomt eller gjettet svar', async () => {
  fakeAnthropic(okReply('', { stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: null } }));
  await assert.rejects(anthropicProvider('k', 'claude-sonnet-5-5').generate(request), (e: unknown) => e instanceof AIError && /avslo/.test(e.message) && !e.retryable);
  fakeAnthropic(okReply('{"summary":"avbr', { stop_reason: 'max_tokens' }));
  await assert.rejects(anthropicProvider('k', 'claude-sonnet-5-5').generate(request), (e: unknown) => e instanceof AIError && /for langt/.test(e.message));
  fakeAnthropic(okReply('ikke json'));
  await assert.rejects(anthropicProvider('k', 'claude-sonnet-5-5').generate(request), /ikke gyldig JSON/);
  fakeAnthropic({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 400);
  await assert.rejects(anthropicProvider('k', 'claude-sonnet-5-5').generate(request), (e: unknown) => e instanceof AIError && !e.retryable);
});

test('kostnad regnes med cache-lesing til redusert pris', () => {
  assert.deepEqual(KNOWN_MODEL_PRICES['claude-sonnet-5-5'], { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
  const cost = estimateCostUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 });
  assert.equal(Math.round(cost * 1000) / 1000, 2 + 1 + 0.2);
  assert.equal(estimateCostUsd('ukjent-modell', { inputTokens: 1000, outputTokens: 1000 }), 0);
});
