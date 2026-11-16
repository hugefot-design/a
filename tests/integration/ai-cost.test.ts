/**
 * Lavere AI-kostnad uten dårligere svar (kostnadsgjennomgangen):
 * - samme offentlige analyse bestilt samtidig av to kunder gir ett kall; den andre får samme svar uten kostnad, og
 *   hva gjenbruken sparte, registreres;
 * - private svar (bedriftsdata, egne dokumenter, egne spørsmål) deles aldri mellom organisasjoner;
 * - den billige modellen prøves først der det passer; holder ikke svaret (format, avslag eller kvalitetskontroll),
 *   lages det på nytt med kvalitetsmodellen – og det forkastede forsøket teller ikke mot kundens kvote;
 * - «Spør om anbudet» kontrollerer sitatene og eskalerer når et sitat ikke står i kilden, og neste spørsmål om de samme
 *   kildene går rett til kvalitetsmodellen mens den har dem i bufferen (per organisasjon);
 * - vakten: forkastes mer enn halvparten av de billige svarene for en funksjon, brukes kvalitetsmodellen direkte;
 * - sjekklisten for tilbud deles når kildene er offentlige.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { closeDb, systemSql } from '../../src/lib/db';
import { AIError, setProviderOverride, type AIProvider, type ModelTier } from '../../src/domain/ai/provider';
import { runAi, type RunAiInput } from '../../src/domain/ai/runner';
import { askTender } from '../../src/domain/ai/chat';
import { aiCostSummary } from '../../src/domain/ai/costs';
import { resetRoutingMemory } from '../../src/domain/ai/routing';
import { generateChecklist } from '../../src/domain/bids/ai';
import { loadOrgContext } from '../../src/domain/org/org';
import type { OrgContext } from '../../src/server/http';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
afterEach(() => setProviderOverride(null));
after(async () => {
  setProviderOverride(null);
  await server.close();
  await closeDb();
});

const answerZ = z.object({ answer: z.string().min(1) });
type Answer = z.infer<typeof answerZ>;
const orgOf = async (acc: TestAccount): Promise<OrgContext> => (await loadOrgContext({ ...acc.user, currentOrgId: acc.orgId }))!;

/** En leverandør som svarer det `respond` gir, teller kallene og bruker listepriser for modellnavnet. */
function fakeProvider(model: string, calls: string[], respond: () => unknown, delayMs = 0): AIProvider {
  return {
    name: 'anthropic',
    model,
    async generate() {
      calls.push(model);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const data = respond();
      return { data, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 0, model, provider: 'anthropic' as const };
    },
  };
}
const tiers = (fast: AIProvider, quality: AIProvider) => (tier: ModelTier) => (tier === 'fast' ? fast : quality);

function input(org: OrgContext, userId: string, extra: Partial<RunAiInput<Answer>> = {}): RunAiInput<Answer> {
  return {
    kind: 'tender_analysis',
    usageKind: 'ai_tender_analysis',
    org,
    userId,
    tenderId: null,
    isPrivate: false,
    system: 'Testinstruks',
    cacheablePrefix: `<kilder>offentlig tekst ${randomUUID()}</kilder>`,
    user: 'Svar i henhold til skjemaet.',
    schemaName: 'answer',
    schemaDescription: 'Svar',
    schema: { type: 'object' },
    validator: answerZ,
    maxOutputTokens: 200,
    mockHint: () => ({ answer: 'testmodus' }),
    ...extra,
  };
}
const usage = async (orgId: string) =>
  (await systemSql()`
    select quantity, cached, escalated, cost_usd::float8 as cost, saved_usd::float8 as saved, analysis_id from usage_records where org_id = ${orgId} order by created_at
  `) as unknown as { quantity: number; cached: boolean; escalated: boolean; cost: number; saved: number; analysisId: string | null }[];

test('samme offentlige analyse bestilt samtidig av to kunder: ett AI-kall, samme svar, og sparingen registreres', async () => {
  const [a, b] = [await createAccount(), await createAccount()];
  const calls: string[] = [];
  setProviderOverride(fakeProvider('claude-sonnet-5-5', calls, () => ({ answer: 'delt svar' }), 400));
  const shared = input(await orgOf(a), a.user.id);
  const [ra, rb] = await Promise.all([runAi(shared), runAi({ ...shared, org: await orgOf(b), userId: b.user.id })]);
  assert.equal(calls.length, 1, 'bare ett kall til leverandøren');
  assert.ok(ra.ok && rb.ok);
  assert.equal(ra.analysisId, rb.analysisId, 'samme svar');
  assert.deepEqual([ra.cached, rb.cached].sort(), [false, true]);
  // Listepris Sonnet 5.5: 1000 inn × $2 + 100 ut × $10 + 200 bufret × $0,10 per million = $0,00302.
  const paid = (await usage(ra.cached ? b.orgId : a.orgId))[0]!;
  const reused = (await usage(ra.cached ? a.orgId : b.orgId))[0]!;
  assert.deepEqual([paid.quantity, paid.cached], [1, false]);
  assert.ok(Math.abs(paid.cost - 0.00302) < 1e-9, `kostnad ${paid.cost}`);
  assert.deepEqual([reused.quantity, reused.cached, reused.cost], [1, true, 0]);
  assert.ok(Math.abs(reused.saved - 0.00302) < 1e-9, 'sparingen er det analysen kostet å lage');
  assert.equal(reused.analysisId, ra.analysisId);
  // Hurtigbufferen og låsen er ryddet.
  assert.equal((await systemSql()`select 1 from ai_inflight`).length, 0, 'ingen låser igjen');
  // Admin-oversikten teller gjenbruk og sparing.
  const summary = await aiCostSummary();
  const row = summary.byFeature.find((r) => r.label === 'Anbudsanalyse')!;
  assert.ok(row.hits >= 1 && row.savedUsd >= 0.00302 - 1e-9);
});

test('private svar deles aldri mellom organisasjoner – men et dobbeltklikk i samme organisasjon gir ett kall', async () => {
  const [a, b] = [await createAccount(), await createAccount()];
  const calls: string[] = [];
  setProviderOverride(fakeProvider('claude-sonnet-5-5', calls, () => ({ answer: 'privat svar' }), 300));
  const priv = input(await orgOf(a), a.user.id, { isPrivate: true, user: '<bedriftsprofil>hemmelig</bedriftsprofil>' });
  const [ra, rb] = await Promise.all([runAi(priv), runAi({ ...priv, org: await orgOf(b), userId: b.user.id })]);
  assert.equal(calls.length, 2, 'to organisasjoner: to kall');
  assert.ok(ra.ok && rb.ok && !ra.cached && !rb.cached && ra.analysisId !== rb.analysisId);
  const owners = (await systemSql()`select org_id from ai_analyses where id = any(${[ra.analysisId, rb.analysisId]}::uuid[]) order by org_id`) as unknown as { orgId: string }[];
  assert.deepEqual(owners.map((o) => o.orgId).sort(), [a.orgId, b.orgId].sort(), 'lagret for hver organisasjon');

  const again = input(await orgOf(a), a.user.id, { isPrivate: true, user: '<bedriftsprofil>nytt spørsmål</bedriftsprofil>' });
  const [r1, r2] = await Promise.all([runAi(again), runAi(again)]);
  assert.equal(calls.length, 3, 'dobbeltklikk: ett kall');
  assert.ok(r1.ok && r2.ok && r1.analysisId === r2.analysisId);
});

test('billig modell først: eskalerer når kvalitetskontrollen feiler, og det forkastede forsøket teller ikke mot kvoten', async () => {
  const acc = await createAccount();
  const org = await orgOf(acc);
  const calls: string[] = [];
  setProviderOverride(
    tiers(
      fakeProvider('claude-haiku-5-5', calls, () => ({ answer: 'tynt' })),
      fakeProvider('claude-sonnet-5-5', calls, () => ({ answer: 'grundig' })),
    ),
  );
  const req = input(org, acc.user.id, { tier: 'fast', qualityCheck: (d) => (d.answer === 'tynt' ? 'for tynt svar' : null) });
  const r = await runAi(req);
  assert.ok(r.ok);
  assert.deepEqual(calls, ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.equal((r.result.data as Answer).answer, 'grundig');
  assert.equal(r.result.model, 'claude-sonnet-5-5');
  const rows = await usage(acc.orgId);
  assert.deepEqual(
    rows.map((u) => [u.quantity, u.escalated, u.cached]),
    [
      [0, true, false],
      [1, true, false],
    ],
    'det billige forsøket koster, men teller ikke mot kvoten',
  );
  assert.ok(rows[0]!.cost > 0 && rows[0]!.cost < rows[1]!.cost, 'Haiku er billigere enn Sonnet');
  const [stored] = (await systemSql()`select escalated_from, model from ai_analyses where id = ${r.analysisId}`) as unknown as { escalatedFrom: string; model: string }[];
  assert.deepEqual([stored!.escalatedFrom, stored!.model], ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  const [failed] = (await systemSql()`
    select error from ai_analyses where status = 'failed' and created_by = ${acc.user.id} order by created_at desc limit 1
  `) as unknown as { error: string }[];
  assert.match(failed!.error, /Billig modell forkastet: for tynt svar/);

  // Samme forespørsel igjen: svaret fra kvalitetsmodellen gjenbrukes – ingen nye kall.
  const again = await runAi(req);
  assert.ok(again.ok && again.cached && again.analysisId === r.analysisId);
  assert.equal(calls.length, 2);

  // Holder det billige svaret, brukes det – ingen eskalering.
  const good = await runAi(input(org, acc.user.id, { tier: 'fast', qualityCheck: () => null }));
  assert.ok(good.ok);
  assert.equal(good.result.model, 'claude-haiku-5-5');
  assert.equal(calls.length, 3);
});

test('eskalerer også når den billige modellen gir feil format eller avslår', async () => {
  const acc = await createAccount();
  const org = await orgOf(acc);
  const calls: string[] = [];
  const quality = fakeProvider('claude-sonnet-5-5', calls, () => ({ answer: 'riktig' }));
  setProviderOverride(tiers(fakeProvider('claude-haiku-5-5', calls, () => ({ feil: 1 })), quality));
  const badFormat = await runAi(input(org, acc.user.id, { tier: 'fast' }));
  assert.ok(badFormat.ok && badFormat.result.model === 'claude-sonnet-5-5');

  const refusing: AIProvider = {
    name: 'anthropic',
    model: 'claude-haiku-5-5',
    async generate() {
      calls.push('avslag');
      throw new AIError('AI-modellen avslo å behandle denne teksten (sikkerhetsfilter hos leverandøren).', false);
    },
  };
  setProviderOverride(tiers(refusing, quality));
  const refused = await runAi(input(org, acc.user.id, { tier: 'fast' }));
  assert.ok(refused.ok && refused.result.model === 'claude-sonnet-5-5', 'avslag hos den billige modellen: kvalitetsmodellen svarer');

  // Uten egen billig modell (samme modell på begge nivåer) er det ingenting å eskalere til: feilen vises som før.
  setProviderOverride(fakeProvider('claude-sonnet-5-5', calls, () => ({ feil: 1 })));
  const noTarget = await runAi(input(org, acc.user.id, { tier: 'fast' }));
  assert.ok(!noTarget.ok && noTarget.code === 'invalid_output');
});

test('«Spør om anbudet»: billig modell først, eskalerer når et sitat ikke står ordrett i kilden, og blir hos kvalitetsmodellen mens den har kildene i bufferen', async () => {
  const n = makeNotice({ title: 'Vakthold ved rådhuset (kostnad-test)', description: 'Vakthold og resepsjon. Det er obligatorisk befaring 2. desember kl. 10.00.' });
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  const acc = await createAccount();
  const org = await orgOf(acc);
  const calls: string[] = [];
  const answer = (quote: string) => () => ({
    answer: 'Ja, det er obligatorisk befaring.',
    claims: [{ text: 'Obligatorisk befaring 2. desember.', basis: 'kilde', source: { source_id: 'S0', page: null, quote } }],
    not_in_sources: false,
  });
  const wrong = 'Befaringen er frivillig og holdes i januar';
  const right = 'obligatorisk befaring 2. desember';

  // 1. Riktig sitat: den billige modellen holder.
  setProviderOverride(tiers(fakeProvider('claude-haiku-5-5', calls, answer(right)), fakeProvider('claude-sonnet-5-5', calls, answer('x'))));
  const cheap = await askTender(org, acc.user.id, tenderId, 'Når er befaringen?');
  assert.ok(cheap.ok && cheap.result.model === 'claude-haiku-5-5');
  assert.deepEqual(calls, ['claude-haiku-5-5']);

  // 2. Oppdiktet sitat: laget på nytt med kvalitetsmodellen.
  setProviderOverride(tiers(fakeProvider('claude-haiku-5-5', calls, answer(wrong)), fakeProvider('claude-sonnet-5-5', calls, answer(right))));
  const r = await askTender(org, acc.user.id, tenderId, 'Er det befaring?');
  assert.ok(r.ok && r.result.model === 'claude-sonnet-5-5');
  assert.deepEqual(calls.slice(1), ['claude-haiku-5-5', 'claude-sonnet-5-5'], 'oppdiktet sitat: laget på nytt med kvalitetsmodellen');
  const checked = r.result.checked as { verified: boolean }[];
  assert.ok(checked.every((c) => c.verified), 'svaret kunden får, har kontrollerte sitater');

  // 3. Neste spørsmål om de samme kildene (innen 5 minutter): rett til kvalitetsmodellen, som har kildene i
  //    leverandørens buffer – ett billig kall (bufret) i stedet for to der det andre starter kaldt.
  const next = await askTender(org, acc.user.id, tenderId, 'Hvem er oppdragsgiver?');
  assert.ok(next.ok && next.result.model === 'claude-sonnet-5-5');
  assert.deepEqual(calls.slice(3), ['claude-sonnet-5-5'], 'den billige modellen ble ikke prøvd');
  const [direct] = (await systemSql()`select escalated_from from ai_analyses where id = ${next.analysisId}`) as unknown as { escalatedFrom: string | null }[];
  assert.equal(direct!.escalatedFrom, null, 'ikke en eskalering – et direkte valg');

  // 4. Private spørsmål: en annen kunde som spør om samme anbud, påvirkes ikke – den billige modellen prøves først.
  const other = await createAccount();
  const theirs = await askTender(await orgOf(other), other.user.id, tenderId, 'Er det befaring?');
  assert.ok(theirs.ok);
  assert.deepEqual(calls.slice(4), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
});

test('vakten: forkastes mer enn halvparten av de billige svarene for en funksjon, brukes kvalitetsmodellen direkte', async () => {
  resetRoutingMemory();
  const acc = await createAccount();
  const org = await orgOf(acc);
  const calls: string[] = [];
  setProviderOverride(tiers(fakeProvider('claude-haiku-5-5', calls, () => ({ answer: 'billig' })), fakeProvider('claude-sonnet-5-5', calls, () => ({ answer: 'grundig' }))));
  // Historikk siste 7 dager for disposisjonen: 30 svar laget på nytt og 10 billige svar som holdt (75 % forkastet).
  const seed = (count: number, rejected: boolean) => systemSql()`
    insert into ai_analyses (kind, input_hash, prompt_version, provider, model, status, escalated_from, created_at)
    select 'bid_structure', 'vakt-test-' || g || '-' || ${String(rejected)}, 'test', 'anthropic', ${rejected ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'},
           'completed', ${rejected ? 'claude-haiku-5-5' : null}, now() - interval '1 day'
    from generate_series(1, ${count}::int) g
  `;
  try {
    await seed(30, true);
    await seed(10, false);
    const req = input(org, acc.user.id, { kind: 'bid_structure', usageKind: 'ai_bid_structure', tier: 'fast', isPrivate: true, qualityCheck: () => null });
    const paused = await runAi(req);
    assert.ok(paused.ok && paused.result.model === 'claude-sonnet-5-5');
    assert.deepEqual(calls, ['claude-sonnet-5-5'], 'den billige modellen ble ikke prøvd');
    const admin = (await aiCostSummary()).cheapFirst!;
    assert.deepEqual([admin.fastModel, admin.qualityModel], ['claude-haiku-5-5', 'claude-sonnet-5-5']);
    const row = admin.rows.find((x) => x.kind === 'bid_structure')!;
    assert.ok(row.paused && row.attempts >= 40 && row.rejectedShare! > 0.5, JSON.stringify(row));
    assert.equal(admin.rows.find((x) => x.kind === 'tender_chat')!.paused, false, 'gjelder bare funksjonen');

    // Holder den billige modellen igjen (andelen faller under halvparten), prøves den først igjen.
    await seed(60, false);
    resetRoutingMemory();
    const resumed = await runAi(input(org, acc.user.id, { kind: 'bid_structure', usageKind: 'ai_bid_structure', tier: 'fast', isPrivate: true, qualityCheck: () => null }));
    assert.ok(resumed.ok && resumed.result.model === 'claude-haiku-5-5');
    assert.deepEqual(calls, ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  } finally {
    await systemSql()`delete from ai_analyses where input_hash like 'vakt-test-%'`;
    resetRoutingMemory();
  }
});

test('sjekklisten for tilbud deles mellom organisasjoner når kildene er offentlige', async () => {
  const n = makeNotice({ title: 'Renhold av skolebygg (sjekkliste-deling)' });
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  const [a, b] = [await createAccount({ plan: 'business' }), await createAccount({ plan: 'business' })];
  const workspace = async (acc: TestAccount) => {
    const c = await clientFor(server.base, acc);
    return (await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` })).location!.split('/').pop()!;
  };
  // AI_PROVIDER=mock i testene: simulerte, men ekte lagrede svar.
  assert.ok((await generateChecklist(await orgOf(a), a.user.id, await workspace(a))).ok);
  assert.ok((await generateChecklist(await orgOf(b), b.user.id, await workspace(b))).ok);
  const rows = (await systemSql()`
    select org_id from ai_analyses where kind = 'bid_checklist' and tender_id = ${tenderId} and status = 'completed'
  `) as unknown as { orgId: string | null }[];
  assert.deepEqual(rows.map((r) => r.orgId), [null], 'ett delt svar, ikke ett per organisasjon');
  const reuse = (await usage(b.orgId)).filter((u) => u.cached);
  assert.equal(reuse.length, 1, 'den andre organisasjonen fikk svaret fra hurtigbufferen');
  // Begge fikk punktene i sin egen sjekkliste.
  for (const acc of [a, b]) {
    const [items] = (await systemSql()`select count(*)::int as n from bid_checklist_items where org_id = ${acc.orgId}`) as unknown as { n: number }[];
    assert.ok(items!.n > 0);
  }
});
