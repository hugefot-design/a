import { first, withTenant } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { CERT_BY_ID, COMPANY_SIZES } from '@/domain/reference';
import { getTender } from '@/domain/tenders/queries';
import { getLatestTenderAnalysis, loadDocumentSources, noticeSource } from '@/domain/ai/analysis';
import { runAi } from '@/domain/ai/runner';
import { BID_CHECKLIST_SYSTEM, BID_DRAFT_SYSTEM, BID_REVIEW_SYSTEM } from '@/domain/ai/prompts';
import { bidChecklistJsonSchema, bidChecklistZ, bidDraftJsonSchema, bidDraftZ, bidReviewJsonSchema, bidReviewZ } from '@/domain/ai/schemas';
import { buildSourceBlock, checkRef, sanitizeSourceText, type AnalysisSource } from '@/domain/ai/sources';
import { mockBidDraft, mockBidReview } from '@/domain/ai/mock';
import { getProfile } from '@/domain/profile/profile';
import { invalidateApproval } from './bids';

async function context(org: OrgContext, userId: string, workspaceId: string) {
  return withTenant({ userId, orgId: org.id }, async (tx) => {
    const ws = first((await tx`select id, tender_id from bid_workspaces where id = ${workspaceId} and org_id = ${org.id}`) as unknown as { id: string; tenderId: string }[]);
    if (!ws) return null;
    const tender = await getTender(tx, ws.tenderId);
    if (!tender) return null;
    const docs = await loadDocumentSources(tx, ws.tenderId);
    const analysis = await getLatestTenderAnalysis(tx, ws.tenderId, org.id);
    const profile = await getProfile(tx, org.id);
    return { ws, tender, sources: [noticeSource(tender), ...docs] as AnalysisSource[], analysis, profile };
  });
}

function profileFacts(profile: Awaited<ReturnType<typeof getProfile>>): string[] {
  if (!profile) return [];
  const facts: string[] = [`Firmanavn: ${profile.companyName}`];
  if (profile.orgNumber) facts.push(`Organisasjonsnummer: ${profile.orgNumber}`);
  if (profile.companySize) facts.push(`Antall ansatte: ${COMPANY_SIZES[profile.companySize] ?? profile.companySize}`);
  if (profile.description) facts.push(`Om bedriften: ${profile.description}`);
  if (profile.services) facts.push(`Tjenester: ${profile.services}`);
  if (profile.certifications.length) {
    facts.push(`Sertifiseringer og godkjenninger (registrert av bedriften): ${profile.certifications.map((c) => CERT_BY_ID.get(c)?.label ?? c).join(', ')}`);
  }
  if (profile.experience) facts.push(`Erfaring og referanser (oppgitt av bedriften): ${profile.experience}`);
  return facts;
}

export async function generateChecklist(org: OrgContext, userId: string, workspaceId: string) {
  const c = await context(org, userId, workspaceId);
  if (!c) return { ok: false as const, error: 'Fant ikke tilbudsarbeidet.' };
  const { block } = buildSourceBlock(c.sources);
  const result = await runAi({
    kind: 'bid_checklist',
    usageKind: 'ai_bid_checklist',
    org,
    userId,
    tenderId: c.tender.id,
    workspaceId,
    isPrivate: true,
    system: BID_CHECKLIST_SYSTEM,
    user: `${block}\n\nLag sjekklisten.`,
    schemaName: 'bid_checklist',
    schemaDescription: 'Sjekkliste for tilbudsarbeid',
    schema: bidChecklistJsonSchema,
    validator: bidChecklistZ,
    maxOutputTokens: 2500,
    mockHint: () => ({
      items: [
        { label: 'Dokumenter kravene i kunngjøringen (testmodus)', category: 'kvalifikasjon' as const, source: { source_id: 'S0', page: null, quote: null } },
      ],
    }),
  });
  if (!result.ok) return result;
  const data = (result.result.data as { items: { label: string; category: string; source: { source_id: string; page: number | null; quote: string | null } | null }[] }).items;
  await withTenant({ userId, orgId: org.id }, async (tx) => {
    const [max] = (await tx`select coalesce(max(sort_order), 0)::int as m from bid_checklist_items where workspace_id = ${workspaceId}`) as unknown as { m: number }[];
    let order = (max?.m ?? 0) + 1;
    for (const item of data) {
      const check = checkRef(item.source, c.sources);
      const ref = check
        ? `${check.sourceTitle ?? check.sourceId}${check.page ? ` s. ${check.page}` : ''}${check.quote ? (check.quoteVerified ? ' – sitat bekreftet' : ' – sitat ikke bekreftet') : ''}`
        : null;
      await tx`
        insert into bid_checklist_items (workspace_id, org_id, label, category, source, source_ref, sort_order)
        values (${workspaceId}, ${org.id}, ${item.label.slice(0, 500)}, ${item.category}, 'ai', ${ref}, ${order++})
      `;
    }
  });
  return { ok: true as const, count: data.length };
}

export async function draftSection(org: OrgContext, userId: string, workspaceId: string, sectionId: string) {
  const c = await context(org, userId, workspaceId);
  if (!c) return { ok: false as const, error: 'Fant ikke tilbudsarbeidet.' };
  const section = await withTenant({ userId, orgId: org.id }, async (tx) =>
    first((await tx`select id, title, requirement, content from bid_sections where id = ${sectionId} and workspace_id = ${workspaceId}`) as unknown as {
      id: string;
      title: string;
      requirement: string | null;
      content: string;
    }[]),
  );
  if (!section) return { ok: false as const, error: 'Fant ikke seksjonen.' };
  const facts = profileFacts(c.profile);
  const { block } = buildSourceBlock(c.sources, 60_000);
  const user = `${block}

<bedriftsprofil>
${facts.map((f) => sanitizeSourceText(f)).join('\n') || '(Bedriftsprofilen er tom.)'}
</bedriftsprofil>

Skriv et utkast til seksjonen «${section.title}» i tilbudet.${section.requirement ? ` Seksjonen skal svare på dette kravet: ${section.requirement}` : ''}
${section.content.trim() ? `Nåværende tekst (forbedre og utvid, men behold fakta):\n${section.content.slice(0, 6000)}` : ''}`;
  const result = await runAi({
    kind: 'bid_draft',
    usageKind: 'ai_bid_draft',
    org,
    userId,
    tenderId: c.tender.id,
    workspaceId,
    isPrivate: true,
    system: BID_DRAFT_SYSTEM,
    user,
    schemaName: 'bid_draft',
    schemaDescription: 'Utkast til tilbudstekst',
    schema: bidDraftJsonSchema,
    validator: bidDraftZ,
    maxOutputTokens: 3000,
    mockHint: () => mockBidDraft(section.title, facts),
    hashExtra: section.id,
  });
  if (!result.ok) return result;
  const draft = result.result.data as { content: string; placeholders: string[] };
  await withTenant({ userId, orgId: org.id }, async (tx) => {
    const content = section.content.trim()
      ? `${section.content.trim()}\n\n--- AI-utkast (må gjennomgås) ---\n${draft.content}`
      : draft.content;
    await tx`update bid_sections set content = ${content.slice(0, 50_000)}, ai_assisted = true, updated_by = ${userId} where id = ${sectionId}`;
    await invalidateApproval(tx, workspaceId);
  });
  return { ok: true as const, placeholders: draft.placeholders.length };
}

export async function reviewDraft(org: OrgContext, userId: string, workspaceId: string) {
  const c = await context(org, userId, workspaceId);
  if (!c) return { ok: false as const, error: 'Fant ikke tilbudsarbeidet.' };
  const sections = await withTenant({ userId, orgId: org.id }, (tx) =>
    tx`select title, content from bid_sections where workspace_id = ${workspaceId} order by sort_order` as unknown as Promise<{ title: string; content: string }[]>,
  );
  const a = c.analysis?.data as Record<string, { text: string }[]> | undefined;
  const requirements = a
    ? [...(a.key_requirements ?? []), ...(a.qualification_criteria ?? []), ...(a.required_documentation ?? [])].map((x) => x.text).slice(0, 40)
    : (c.tender.description ?? '')
        .split(/(?<=[.!?])\s+/)
        .filter((s) => /\b(må|skal|krav)\b/i.test(s))
        .slice(0, 20);
  if (!requirements.length) return { ok: false as const, error: 'Fant ingen krav å sammenligne med. Kjør AI-analysen av kunngjøringen først.' };
  const sectionText = sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n');
  const user = `<kilder>
<kilde id="K" type="krav" tittel="Krav fra kunngjøringen">
${requirements.map((r, i) => `${i + 1}. ${sanitizeSourceText(r)}`).join('\n')}
</kilde>
<kilde id="U" type="utkast" tittel="Tilbudsutkast">
${sanitizeSourceText(sectionText).slice(0, 60_000)}
</kilde>
</kilder>

Vurder om utkastet dekker hvert krav.`;
  const result = await runAi({
    kind: 'bid_review',
    usageKind: 'ai_bid_review',
    org,
    userId,
    tenderId: c.tender.id,
    workspaceId,
    isPrivate: true,
    system: BID_REVIEW_SYSTEM,
    user,
    schemaName: 'bid_review',
    schemaDescription: 'Kravdekning i tilbudsutkast',
    schema: bidReviewJsonSchema,
    validator: bidReviewZ,
    maxOutputTokens: 3000,
    mockHint: () => mockBidReview(requirements, sectionText),
  });
  if (!result.ok) return result;
  return { ok: true as const };
}
