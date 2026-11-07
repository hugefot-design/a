/**
 * «Til handling» på Oversikt: én arbeidsliste i stedet for mange lister.
 *
 * Bare fra organisasjonens egne data (lagrede anbud, tilbudsarbeid, resultater og treff) – ingenting anslått.
 * Hvert punkt har en lenke dit det løses. Sortert etter hvor mye det haster, så etter tidspunkt.
 */
import type { Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { noticeSignals } from '@/domain/matching/screening';

export type ActionKind = 'frist' | 'sporsmalsfrist' | 'befaring' | 'godkjenning' | 'levere' | 'resultat' | 'treff';
export type Urgency = 'haster' | 'snart' | 'info';

export interface ActionItem {
  kind: ActionKind;
  /** Hva som skal gjøres. */
  title: string;
  /** Hvilket anbud det gjelder. */
  detail: string;
  href: string;
  due: Date | null;
  urgency: Urgency;
}

const DAY = 86_400_000;
const MAX_ITEMS = 10;
const URGENCY_ORDER: Record<Urgency, number> = { haster: 0, snart: 1, info: 2 };

export function sortActions(items: ActionItem[]): ActionItem[] {
  return [...items].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || a.detail.localeCompare(b.detail, 'nb'),
  );
}

const osloDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Kalenderdager i norsk tid («i morgen» betyr neste dato, ikke 24 timer). */
export function calendarDaysUntil(due: Date, now: Date): number {
  return Math.round((Date.parse(osloDate.format(due)) - Date.parse(osloDate.format(now))) / DAY);
}

export async function loadActionItems(tx: Tx, org: OrgContext, now: Date = new Date()): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  const week = new Date(now.getTime() + 7 * DAY);

  // 1–3. Lagrede anbud som ikke er levert: tilbudsfrist og spørsmålsfrist innen en uke, og obligatorisk befaring.
  const open = (await tx`
    select b.id as bookmark_id, t.id as tender_id, t.title, t.deadline_at, t.questions_deadline_at, t.description
    from bookmarks b join tenders t on t.id = b.tender_id
    where b.org_id = ${org.id} and b.status in ('watching', 'preparing')
      and t.deadline_at > ${now} and t.deadline_at <= ${new Date(now.getTime() + 30 * DAY)}
    order by t.deadline_at asc
    limit 50
  `) as unknown as { bookmarkId: string; tenderId: string; title: string; deadlineAt: Date; questionsDeadlineAt: Date | null; description: string | null }[];
  for (const t of open) {
    const days = calendarDaysUntil(t.deadlineAt, now);
    if (t.deadlineAt <= week) {
      items.push({
        kind: 'frist',
        title: days <= 0 ? 'Tilbudsfristen er i dag' : days === 1 ? 'Tilbudsfristen er i morgen' : `Tilbudsfrist om ${days} dager`,
        detail: t.title,
        href: `/app/anbud/${t.tenderId}`,
        due: t.deadlineAt,
        urgency: days <= 2 ? 'haster' : 'snart',
      });
    }
    if (t.questionsDeadlineAt && t.questionsDeadlineAt > now && t.questionsDeadlineAt <= week) {
      const q = calendarDaysUntil(t.questionsDeadlineAt, now);
      items.push({
        kind: 'sporsmalsfrist',
        title: q <= 0 ? 'Spørsmålsfristen er i dag' : q === 1 ? 'Spørsmålsfristen er i morgen' : `Spørsmålsfrist om ${q} dager`,
        detail: t.title,
        href: `/app/anbud/${t.tenderId}`,
        due: t.questionsDeadlineAt,
        urgency: q <= 1 ? 'haster' : 'snart',
      });
    }
    const visit = noticeSignals(t.description).mandatoryVisit;
    if (visit) {
      items.push({ kind: 'befaring', title: 'Obligatorisk befaring – sjekk dato og meld dere på', detail: t.title, href: `/app/anbud/${t.tenderId}#krav`, due: null, urgency: 'snart' });
    }
  }

  // 4. Tilbudsarbeid: venter på godkjenning, eller godkjent men ikke levert med frist innen en uke.
  if (org.entitlements.bidAssistant) {
    const ws = (await tx`
      select w.id, w.status, t.title, t.deadline_at
      from bid_workspaces w join tenders t on t.id = w.tender_id
      where w.org_id = ${org.id} and w.status in ('in_review', 'approved')
      order by t.deadline_at asc nulls last
      limit 20
    `) as unknown as { id: string; status: string; title: string; deadlineAt: Date | null }[];
    for (const w of ws) {
      if (w.status === 'in_review') {
        items.push({
          kind: 'godkjenning',
          title: org.role === 'member' ? 'Venter på godkjenning fra eier eller administrator' : 'Tilbud venter på godkjenning',
          detail: w.title,
          href: `/app/tilbud/${w.id}`,
          due: w.deadlineAt,
          urgency: w.deadlineAt && w.deadlineAt <= week ? 'haster' : 'snart',
        });
      } else if (w.deadlineAt && w.deadlineAt > now && w.deadlineAt <= week) {
        items.push({ kind: 'levere', title: 'Godkjent – husk å levere og merke som levert', detail: w.title, href: `/app/tilbud/${w.id}`, due: w.deadlineAt, urgency: 'haster' });
      }
    }
  }

  // 5. Leverte tilbud uten resultat: tildelingen er publisert, eller det er gått tre måneder.
  const pending = (await tx`
    select b.tender_id, t.title, b.submitted_at,
           exists (select 1 from contract_awards a where a.tender_id = b.tender_id) as awarded
    from bookmarks b join tenders t on t.id = b.tender_id
    where b.org_id = ${org.id} and b.status = 'submitted'
    limit 50
  `) as unknown as { tenderId: string; title: string; submittedAt: Date | null; awarded: boolean }[];
  for (const p of pending) {
    if (p.awarded) {
      items.push({ kind: 'resultat', title: 'Tildelingen er publisert – registrer resultatet', detail: p.title, href: `/app/anbud/${p.tenderId}#resultat`, due: null, urgency: 'snart' });
    } else if (p.submittedAt && now.getTime() - p.submittedAt.getTime() > 90 * DAY) {
      items.push({ kind: 'resultat', title: 'Levert for over tre måneder siden – har dere fått svar?', detail: p.title, href: `/app/anbud/${p.tenderId}#resultat`, due: null, urgency: 'info' });
    }
  }

  // 6. Sterke nye treff som ikke er lagret (høyst tre).
  if (org.entitlements.matching) {
    const strong = (await tx`
      select t.id, t.title, m.score, t.deadline_at
      from match_results m join tenders t on t.id = m.tender_id
      where m.org_id = ${org.id} and not m.excluded and m.score >= 75
        and t.first_seen_at > ${new Date(now.getTime() - 3 * DAY)} and t.deadline_at > ${now}
        and not exists (select 1 from bookmarks b where b.org_id = ${org.id} and b.tender_id = t.id)
        and not t.is_sample
      order by m.score desc, t.deadline_at asc
      limit 3
    `) as unknown as { id: string; title: string; score: number; deadlineAt: Date }[];
    for (const s of strong) {
      items.push({ kind: 'treff', title: `Nytt sterkt treff (${s.score} av 100) – vurder å lagre`, detail: s.title, href: `/app/anbud/${s.id}`, due: s.deadlineAt, urgency: 'info' });
    }
  }

  return sortActions(items).slice(0, MAX_ITEMS);
}
