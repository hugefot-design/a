/**
 * Intelligence som PDF: samme rapport som siden, lagt opp som et A4-dokument som kan sendes til ledelsen eller
 * legges ved en beslutning. Laget med pdfkit (åpen kildekode, kjører lokalt – ingen ekstern tjeneste).
 *
 * Standardskriften (Helvetica) dekker vesteuropeiske språk, også æ, ø og å. Tegn utenfor (piler, haker) byttes ut.
 * Flere språk med andre tegn krever at en skrifttype bygges inn (pdfkit støtter det).
 */
import PDFDocument from 'pdfkit';
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import { RECOMMENDATION_LABEL } from '@/domain/profit/recommendation';
import { REQUIREMENT_KIND_LABEL } from './build';
import type { Basis, IntelligenceReport, Point, SourceRef } from './types';
import { basisLabel, uncertaintyList } from './basis';

const C = {
  navy: '#0b1f3a',
  ink: '#172033',
  muted: '#5a677d',
  line: '#d9dfe8',
  paper: '#f5f7fa',
  ok: '#15803d',
  urgent: '#b45309',
  danger: '#b91c1c',
  neutral: '#475569',
  fact: '#0f766e',
  calculation: '#1d4ed8',
  ai: '#7c3aed',
};
const VERDICT_COLOR = { go: C.ok, clarify: C.urgent, no_go: C.danger, insufficient: C.neutral } as const;
const LEVEL_COLOR = { lav: C.ok, middels: C.urgent, høy: C.danger } as const;

// Tegn som finnes i Windows-1252 (standardskriften) – resten byttes ut eller fjernes.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = { '\u2192': '->', '\u2190': '<-', '\u2265': '>=', '\u2264': '<=', '\u2713': 'OK', '\u2717': 'x', '\u2212': '-', '\u202f': ' ', '\u2009': ' ', '\u200b': '' };
export function safe(text: string | null | undefined): string {
  if (!text) return '';
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch) || ch === '\n') out += ch;
    else if (/\s/.test(ch)) out += ' ';
    else out += '?';
  }
  return out;
}

/** Lange kravsetninger kortes til et lesbart utdrag (hele teksten står i dokumentet og på siden). */
const clip = (s: string, max = 280) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const date = (d: Date | null, withTime = false) =>
  d
    ? new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d)
    : 'ikke oppgitt';
const money = (n: number | null, currency: string) => (n === null ? 'mangler' : currency === 'NOK' ? fmtKr(n) : `${fmtNumber(Math.round(n))} ${currency}`);

function sourceText(s: SourceRef | null | undefined): string | null {
  if (!s) return null;
  const where = [s.label, s.page ? `side ${s.page}` : null].filter(Boolean).join(', ');
  const verified = s.kind === 'ai' ? (s.verified ? ' (sitat kontrollert)' : ' (sitat ikke kontrollert)') : '';
  const quote = s.quote ? ` – «${s.quote.length > 180 ? `${s.quote.slice(0, 177).trimEnd()}…` : s.quote}»` : '';
  return `Kilde: ${where}${verified}${quote}`;
}

class Writer {
  constructor(readonly doc: PDFKit.PDFDocument) {}
  get left() {
    return this.doc.page.margins.left;
  }
  get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }
  get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }
  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: string; indent?: number; gap?: number } = {}) {
    const indent = o.indent ?? 0;
    this.doc
      .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.size ?? 10)
      .fillColor(o.color ?? C.ink)
      .text(safe(s), this.left + indent, this.doc.y, { width: this.width - indent });
    if (o.gap) this.doc.moveDown(o.gap);
  }
  heading(num: string, title: string, sub?: string) {
    this.ensure(70);
    this.doc.moveDown(0.8);
    const y = this.doc.y;
    this.doc.circle(this.left + 9, y + 8, 9).fill(C.navy);
    this.doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(num, this.left, y + 4, { width: 18, align: 'center' });
    this.doc.font('Helvetica-Bold').fontSize(14).fillColor(C.navy).text(safe(title), this.left + 26, y + 1, { width: this.width - 26 });
    if (sub) this.doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(safe(sub), this.left + 26, this.doc.y + 1, { width: this.width - 26 });
    this.doc.moveTo(this.left, this.doc.y + 5).lineTo(this.left + this.width, this.doc.y + 5).lineWidth(0.6).strokeColor(C.line).stroke();
    this.doc.moveDown(0.9);
  }
  sub(title: string) {
    this.ensure(40);
    this.doc.moveDown(0.4);
    this.text(title, { size: 10.5, bold: true, color: C.navy });
    this.doc.moveDown(0.15);
  }
  /** Punkt med merke for grunnlag (Fakta/Beregning/AI) og kilde under. */
  point(p: Point | { text: string; basis?: Basis; source?: SourceRef | null }, o: { bullet?: string; color?: string } = {}) {
    const src = sourceText(p.source);
    this.ensure(28 + (src ? 12 : 0));
    const y = this.doc.y;
    this.doc.font('Helvetica-Bold').fontSize(9).fillColor(o.color ?? C.muted).text(o.bullet ?? '•', this.left, y, { width: 10 });
    const x = this.left + 12;
    const w = this.width - 12;
    this.doc.y = y;
    if (p.basis) {
      this.doc.font('Helvetica-Bold').fontSize(7).fillColor(C[p.basis]).text(`${safe(basisLabel(p.basis, p.source).label.toUpperCase())}  `, x, y, { continued: true, width: w });
      this.doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(safe(p.text), { width: w });
    } else {
      this.doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(safe(p.text), x, y, { width: w });
    }
    if (src) this.doc.font('Helvetica').fontSize(7.8).fillColor(C.muted).text(safe(src), x, this.doc.y + 1, { width: w });
    this.doc.moveDown(0.35);
  }
  bar(label: string, value: number, max: number, color: string, right: string) {
    const labelW = 170;
    const labelH = this.doc.font('Helvetica').fontSize(9).heightOfString(safe(label), { width: labelW - 8 });
    this.ensure(Math.max(18, labelH + 6));
    const y = this.doc.y;
    const barW = this.width - labelW - 70;
    this.doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(safe(label), this.left, y, { width: labelW - 8 });
    this.doc.roundedRect(this.left + labelW, y + 2, barW, 7, 3.5).fill(C.paper);
    const w = max > 0 ? Math.max(0, Math.min(1, value / max)) * barW : 0;
    if (w > 0) this.doc.roundedRect(this.left + labelW, y + 2, Math.max(w, 4), 7, 3.5).fill(color);
    this.doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(safe(right), this.left + labelW + barW + 8, y, { width: 62, align: 'right' });
    this.doc.y = y + Math.max(15, labelH + 4);
  }
  note(s: string) {
    this.ensure(24);
    this.text(s, { size: 8.5, color: C.muted, gap: 0.3 });
  }
}

export async function intelligencePdf(r: IntelligenceReport, meta: { orgName: string }): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 54, bottom: 62, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: safe(`AnbudRadar Intelligence – ${r.tender.title}`), Author: 'AnbudRadar', Subject: safe(`Beslutningsgrunnlag for ${meta.orgName}`), Creator: 'AnbudRadar' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const w = new Writer(doc);
  const t = r.tender;
  const d = r.decision;

  // ------------------------------------------------------------------------------ Topp og beslutning
  w.text('ANBUDRADAR INTELLIGENCE', { size: 8.5, bold: true, color: C.muted });
  doc.moveDown(0.3);
  w.text(t.title, { size: 17, bold: true, color: C.navy, gap: 0.25 });
  w.text(
    [t.buyerName ?? 'Oppdragsgiver ikke oppgitt', `${t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'}: ${date(t.deadlineAt, t.deadlineTimeKnown)}`, t.estimatedValue !== null ? `Estimert verdi: ${money(t.estimatedValue, t.currency)}` : null]
      .filter(Boolean)
      .join('  ·  '),
    { size: 9.5, color: C.muted },
  );
  w.text(`Kilder: ${t.sources.map((s) => `${s.source === 'doffin' ? 'Doffin' : s.source === 'ted' ? 'TED' : s.source} ${s.noticeId}`).join(', ') || 'ingen'}  ·  Laget for ${meta.orgName} ${date(r.generatedAt, true)}`, { size: 8.5, color: C.muted, gap: 0.8 });

  // Beslutningsboks
  const color = VERDICT_COLOR[d.verdict];
  const boxTop = doc.y;
  const headlineH = doc.font('Helvetica').fontSize(11).heightOfString(safe(d.headline), { width: w.width - 40 });
  const boxH = 40 + headlineH;
  doc.roundedRect(w.left, boxTop, w.width, boxH, 6).fill(C.paper);
  doc.rect(w.left, boxTop, 5, boxH).fill(color);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('ANBEFALING (GO/NO-GO)', w.left + 20, boxTop + 10, { width: w.width - 40 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(safe(d.label), w.left + 20, boxTop + 21, { width: w.width - 40 });
  doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(safe(d.headline), w.left + 20, doc.y + 2, { width: w.width - 40 });
  doc.y = boxTop + boxH + 12;

  // Nøkkeltall
  const tiles: [string, string, string][] = [
    ['Passer', r.fit.score !== null ? `${r.fit.score}/100` : r.fit.availability === 'locked' ? 'Ikke i planen' : 'Ukjent', r.fit.level === 'ukjent' ? '' : `${r.fit.level} treff`],
    ['Risiko', `${r.risk.score}/100`, `${r.risk.level} risiko`],
    [
      'Lønnsomhet',
      r.profit.calc?.atContractValue ? `${fmtNumber(r.profit.calc.atContractValue.marginPct)} %` : r.profit.availability === 'locked' ? 'Ikke i planen' : 'Mangler',
      r.profit.calc?.atContractValue ? 'margin ved kontraktsverdi' : r.profit.availability === 'no_costs' ? 'kostnader ikke lagt inn' : '',
    ],
    ['Datagrunnlag', d.confidence.level.charAt(0).toUpperCase() + d.confidence.level.slice(1), `${d.confidence.score} av ${d.confidence.max}`],
  ];
  const tileW = (w.width - 18) / 4;
  const tileTop = doc.y;
  tiles.forEach(([label, value, hint], idx) => {
    const x = w.left + idx * (tileW + 6);
    doc.roundedRect(x, tileTop, tileW, 52, 5).lineWidth(0.6).strokeColor(C.line).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted).text(safe(label.toUpperCase()), x + 9, tileTop + 8, { width: tileW - 18 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.navy).text(safe(value), x + 9, tileTop + 19, { width: tileW - 18 });
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(safe(hint), x + 9, tileTop + 37, { width: tileW - 18 });
  });
  doc.y = tileTop + 64;

  if (d.blockers.length) {
    w.sub('Hindringer');
    for (const p of d.blockers) w.point(p, { bullet: '!', color: C.danger });
  }
  if (d.reasons.length) {
    w.sub('Grunner for');
    for (const p of d.reasons.slice(0, 6)) w.point(p, { bullet: '+', color: C.ok });
  }
  if (d.concerns.length) {
    w.sub('Må avklares');
    for (const p of d.concerns.slice(0, 7)) w.point(p, { bullet: '?', color: C.urgent });
  }
  if (d.missing.length) {
    w.sub('Dette ville gjort vurderingen sikrere');
    for (const m of d.missing) w.point({ text: m.text });
  }
  const unknown = uncertaintyList(r);
  if (unknown.length) {
    w.sub('Det vi ikke vet sikkert');
    for (const u of unknown) w.point({ text: u }, { bullet: '?', color: C.urgent });
  }
  w.note(`Datagrunnlag: ${d.coverage.map((c) => `${c.label}: ${c.detail}`).join(' · ')}.`);

  // ------------------------------------------------------------------------------ 1. Passer det
  const f = r.fit;
  w.heading('1', 'Passer det for oss?', 'Treff mot bedriftsprofilen, kvalifikasjoner, geografi og kapasitet.');
  if (f.availability === 'locked') w.note(`Treff mot bedriftsprofilen er med i ${r.lockedPlans.fit ?? 'en høyere plan'}.`);
  else if (f.availability === 'no_profile') w.note('Bedriftsprofilen er ikke fylt ut – treffet kan ikke regnes ut.');
  else if (f.score === null) w.note('Treffet er ikke regnet ut ennå.');
  else {
    w.text(`Treff: ${f.score} av 100 (${f.level})${f.excluded ? ' – utelukket av profilen' : ''}`, { bold: true, gap: 0.3 });
    for (const c of f.components) w.bar(c.label, c.value, c.max, C.calculation, `${c.value}/${c.max}`);
    if (f.strengths.length) {
      w.sub('Det som passer');
      for (const p of f.strengths.slice(0, 5)) w.point(p);
    }
    if (f.gaps.length) {
      w.sub('Avvik og mangler');
      for (const p of f.gaps.slice(0, 6)) w.point(p);
    }
  }
  if (f.qualifications.length) {
    w.sub('Kvalifikasjoner som nevnes');
    for (const q of f.qualifications) {
      w.point({ text: `${q.label}: ${q.have ? `har (${q.via === 'bemanning' ? 'bemanningen' : 'profilen'})` : 'mangler'}${q.legal ? ' – lovpålagt' : ''}`, basis: 'fact' }, { bullet: q.have ? '+' : '!', color: q.have ? C.ok : C.danger });
    }
  }
  if (f.turnover) w.point({ text: `Omsetningskrav: minst ${fmtKr(f.turnover.required)}; profilen: ${f.turnover.have !== null ? fmtKr(f.turnover.have) : 'ikke oppgitt'}.`, basis: 'fact' });
  w.point({ text: `Sted: ${f.regions.names.slice(0, 6).join(', ') || 'ikke oppgitt'}${f.regions.names.length > 6 ? ` og ${f.regions.names.length - 6} til` : ''}${f.regions.inProfile === null ? '' : f.regions.inProfile ? ' – i området dere dekker' : ' – utenfor området i profilen'}.`, basis: 'fact' });
  if (f.capacity) w.point({ text: `Kapasitet: ${f.capacity.status}${f.capacity.gapHoursPerYear ? `, mangler ca. ${fmtNumber(f.capacity.gapHoursPerYear)} timer per år` : ''}.`, basis: 'calculation' });
  if (f.ai) {
    w.sub(`AI-vurdering av egnethet${f.ai.isMock ? ' (simulert – testmodus)' : ''}: ${f.ai.fit}`);
    w.point({ text: f.ai.overall, basis: 'ai' });
    for (const p of f.ai.unfulfilled.slice(0, 4)) w.point(p);
  }

  // ------------------------------------------------------------------------------ 2. Risiko
  const k = r.risk;
  w.heading('2', 'Risiko', 'Krav, frister, dokumentasjon, avvisningsgrunner og kontraktsvilkår – med kilde.');
  w.text(`Risikoscore: ${k.score} av 100 (${k.level})`, { bold: true, color: LEVEL_COLOR[k.level] });
  w.note('Summen av faktorene under (tak 100). Under 25 er lav, 25–49 middels, 50 eller mer høy. En beregning – ikke en sannsynlighet.');
  for (const fct of k.factors) w.bar(`${fct.label}${fct.blocker ? ' (hindring)' : ''}`, fct.points, 50, LEVEL_COLOR[fct.severity], `+${fct.points}`);
  for (const fct of k.factors) w.point({ text: `${fct.label}: ${fct.explanation}`, basis: fct.basis, source: fct.sources[0] ?? null });
  w.note(k.read.noticeOnly ? 'Lest: bare kunngjøringen.' : `Lest: kunngjøringen og ${k.read.documents} dokumenter (${k.read.pages} sider).${k.read.notReadable.length ? ` Ikke lesbare: ${k.read.notReadable.join(', ')}.` : ''}`);
  if (k.deadlines.length) {
    w.sub('Frister');
    for (const dl of k.deadlines) w.point({ text: `${dl.label}: ${date(dl.at, dl.timeKnown)}`, basis: 'fact' });
  }
  const groups: [string, Point[]][] = [
    [`${REQUIREMENT_KIND_LABEL.avvisning} og minstekrav`, k.rejection],
    ['Dokumentasjon og kvalifikasjon', k.documentation],
    [REQUIREMENT_KIND_LABEL.befaring, k.siteVisit],
  ];
  for (const [title, pts] of groups) {
    if (!pts.length) continue;
    w.sub(title);
    for (const p of pts.slice(0, 5)) w.point({ text: clip(p.text), basis: p.basis, source: p.source ? { ...p.source, quote: null } : null });
  }
  if (k.terms.length) {
    w.sub('Kontraktsvilkår som kan koste');
    for (const term of k.terms) for (const p of term.points.slice(0, 1)) w.point({ text: `${term.label}: ${clip(p.text, 220)}`, basis: p.basis, source: p.source ? { ...p.source, quote: null } : null });
  }
  if (k.contractFindings.length) {
    w.sub('Kontraktsrisiko (AI-vurdering fra Lønnsomhet)');
    for (const p of k.contractFindings.slice(0, 5)) w.point({ text: `${p.text}${p.consequence ? ` ${p.consequence}` : ''}`, basis: 'ai', source: p.source });
  }
  if (k.ai) {
    w.sub(`AI-analysen${k.ai.isMock ? ' (simulert – testmodus)' : ''}`);
    for (const p of k.ai.points.slice(0, 5)) w.point(p);
  }

  // ------------------------------------------------------------------------------ 3. Lønnsomhet
  const p = r.profit;
  w.heading('3', 'Lønnsomhet', 'Fra kalkylen deres og publiserte tildelinger. Ingen anslag fylles inn.');
  if (p.availability === 'locked') w.note(`Lønnsomhetskalkulatoren er med i ${r.lockedPlans.profit ?? 'en høyere plan'}.`);
  else if (p.availability === 'no_costs') w.note('Kostnadene er ikke lagt inn ennå – lønnsomheten kan ikke regnes ut.');
  if (p.calc) {
    const c = p.calc;
    for (const [label, value] of [
      ['Selvkost', money(c.breakEven, p.currency)],
      ['Minstepris', money(c.minPrice, p.currency)],
      ['Målpris', money(c.targetPrice, p.currency)],
      ['Kontraktsverdi', c.atContractValue ? `${money(c.atContractValue.price, p.currency)} (margin ${fmtNumber(c.atContractValue.marginPct)} %)` : 'ikke oppgitt'],
    ] as const) {
      w.point({ text: `${label}: ${value}`, basis: 'calculation' });
    }
    const sens = c.sensitivity.filter((s) => s.increasePct > 0 && s.profitAtContractValue !== null);
    if (sens.length && c.atContractValue) {
      w.sub('Følsomhet: fortjeneste ved kontraktsverdien hvis kostnadene øker');
      const maxAbs = Math.max(...sens.map((s) => Math.abs(s.profitAtContractValue!)), Math.abs(c.atContractValue.profit), 1);
      w.bar('Som kalkulert', Math.max(0, c.atContractValue.profit), maxAbs, c.atContractValue.profit >= 0 ? C.ok : C.danger, money(c.atContractValue.profit, p.currency));
      for (const s of sens) w.bar(`+${s.increasePct} % kostnader`, Math.max(0, s.profitAtContractValue!), maxAbs, s.profitAtContractValue! >= 0 ? C.ok : C.danger, money(s.profitAtContractValue!, p.currency));
    }
    if (p.recommendation) {
      w.sub(`Anbefaling i Lønnsomhet: ${RECOMMENDATION_LABEL[p.recommendation.recommendation]}`);
      for (const reason of p.recommendation.reasons.slice(0, 5)) w.point({ text: reason, basis: 'calculation' });
    }
  }
  if (p.market) {
    w.sub(`Markedspris: ${p.market.n} tildelinger${p.market.label ? ` ${p.market.label}` : ''}`);
    if (p.market.stats) {
      const s = p.market.stats;
      const unit = p.market.unit === 'per_year' ? ' per år' : '';
      w.point({ text: `Median ${money(s.median, p.currency)}${unit}; midterste halvdel ${money(s.p25, p.currency)} – ${money(s.p75, p.currency)}${unit} (${s.n} kontrakter).`, basis: 'calculation', source: { kind: 'award', label: 'Tildelingskunngjøringer (TED/Doffin)' } });
      for (const pos of p.market.positions) w.point({ text: `${pos.label} ${money(pos.value, p.currency)}${unit}: lavere enn ${fmtNumber(pos.cheaperThanPct)} % av tildelingene.`, basis: 'calculation' });
      if (p.market.strength === 'few') w.note(`Få sammenlignbare (${p.market.n}) – bruk tallene som en pekepinn.`);
    } else w.note('For få sammenlignbare tildelinger til å regne markedspris.');
    if (p.market.excluded.frameworks || p.market.excluded.otherCurrency) w.note(`Holdt utenfor: ${p.market.excluded.frameworks} rammeavtaler, ${p.market.excluded.otherCurrency} i annen valuta.`);
  }
  if (p.calcAccuracy) w.point({ text: `Tidligere kalkyler: målprisen har i median ligget ${fmtNumber(Math.abs(p.calcAccuracy.medianPct))} % ${p.calcAccuracy.medianPct >= 0 ? 'over' : 'under'} prisen som vant (${p.calcAccuracy.n} anbud).`, basis: 'calculation', source: { kind: 'own', label: 'Resultatene deres' } });

  // ------------------------------------------------------------------------------ 4. Konkurranse
  const comp = r.competition;
  w.heading('4', 'Konkurranse', 'Bare publiserte tildelinger, siste fem år. Mange anskaffelser publiseres uten tildeling.');
  if (comp.availability === 'locked') w.note(`Konkurranseinnsikt er med i ${r.lockedPlans.competition ?? 'en høyere plan'}.`);
  else {
    if (comp.thisTender.length) {
      w.sub('Tildelt i dette anbudet');
      for (const a of comp.thisTender) w.point({ text: `${a.name}${a.isUs ? ' (dere)' : ''}${a.value !== null ? `: ${money(a.value, a.currency ?? r.tender.currency)}` : ''}`, basis: 'fact', source: { kind: 'award', label: 'Tildelingskunngjøringen' } });
    }
    w.sub(`Vinnere hos oppdragsgiveren i samme bransje${comp.buyer ? ` (${comp.buyer.contracts} kontrakter)` : ''}`);
    if (comp.buyer?.winners.length) for (const x of comp.buyer.winners.slice(0, 6)) w.point({ text: `${x.name}: ${x.wins} ${x.wins === 1 ? 'kontrakt' : 'kontrakter'}${x.lastWin ? `, sist ${date(x.lastWin)}` : ''}${x.beatUs ? ` – har slått dere ${x.beatUs} ${x.beatUs === 1 ? 'gang' : 'ganger'}` : ''}`, basis: 'fact' });
    else w.note('Ingen publiserte tildelinger hos oppdragsgiveren i samme bransje.');
    if (comp.similar) {
      w.sub(`Vinnere av lignende kontrakter ${comp.similar.label} (${comp.similar.contracts} kontrakter)`);
      for (const x of comp.similar.winners.slice(0, 6)) w.point({ text: `${x.name}: ${x.wins} ${x.wins === 1 ? 'kontrakt' : 'kontrakter'}${x.beatUs ? ` – har slått dere ${x.beatUs} ${x.beatUs === 1 ? 'gang' : 'ganger'}` : ''}`, basis: 'fact' });
    }
    if (comp.bids) w.point({ text: `Antall tilbud i lignende konkurranser: median ${fmtNumber(comp.bids.median)} (fra ${comp.bids.min} til ${comp.bids.max}, ${comp.bids.n} konkurranser).`, basis: 'calculation', source: { kind: 'award', label: 'Tildelingskunngjøringer' } });
    else w.note('Antall tilbud er ikke oppgitt i nok lignende konkurranser.');
  }

  // ------------------------------------------------------------------------------ 5. Handlingsplan
  w.heading('5', 'Handlingsplan', 'Stegene i rekkefølge. Datoer fra kunngjøringen er fakta; intern godkjenning er et forslag.');
  if (!r.plan.length) w.note('Fristen har gått ut – ingen steg gjenstår.');
  for (const s of r.plan) {
    const due = s.due ? `${date(s.due, s.dueBasis === 'fact')}${s.dueBasis === 'calculation' ? ' (forslag)' : ''}  ` : '';
    w.point({ text: `${due}${s.title}${s.detail ? ` – ${s.detail}` : ''}`, basis: s.basis, source: s.source }, { bullet: s.done ? 'v' : String(r.plan.indexOf(s) + 1), color: s.done ? C.ok : s.priority === 'høy' ? C.danger : C.muted });
  }

  // ------------------------------------------------------------------------------ 6. Læring
  const l = r.learning;
  w.heading('6', 'Læring fra deres resultater', `Brukes når minst ${l.minDecided} tilbud er avgjort (vunnet eller ikke vunnet).`);
  const g = (x: typeof l.sameBuyer) => `${x.delivered} levert, ${x.won} vunnet, ${x.lost} ikke vunnet${x.pending ? `, ${x.pending} venter` : ''}`;
  w.point({ text: `Hos denne oppdragsgiveren: ${g(l.sameBuyer)}.`, basis: 'fact', source: { kind: 'own', label: 'Resultatene deres' } });
  w.point({ text: `I lignende anbud: ${g(l.similar)}.`, basis: 'fact', source: { kind: 'own', label: 'Resultatene deres' } });
  for (const ins of l.insights) w.point(ins);
  if (l.applied.length) for (const a of l.applied) w.point({ text: `Brukt i vurderingen: ${a}` });
  else w.note('Ikke nok avgjorte tilbud til at resultatene påvirker vurderingen ennå.');

  // ------------------------------------------------------------------------------ Metode
  w.heading('7', 'Slik er vurderingen laget');
  for (const line of [
    'FAKTA står i kunngjøringen, et dokument, en publisert tildeling eller i deres egne data – med kilde og side der det finnes.',
    'BEREGNING er regnet ut av AnbudRadar fra fakta: treff mot profilen, risikoscoren, kalkylen, markedspris og antall tilbud.',
    `AI er en AI-vurdering, merket med om sitatet ble funnet ordrett i kilden.${r.ai.mode === 'off' ? ' AI er ikke slått på – denne vurderingen bygger bare på fakta og beregninger.' : r.ai.mode === 'mock' ? ' AI-svarene her er simulert (testmodus).' : ''}`,
    'Anbefalingen: hindringer gir «Ikke gå videre»; uten profil og kalkyle «For lite grunnlag»; svakt treff (under 40) «Ikke gå videre»; godt treff (60+) uten høy risiko og uten «Høy risiko» i Lønnsomhet «Gå videre»; ellers «Avklar først».',
    'AnbudRadar anslår ikke sannsynligheten for å vinne. Kontroller kravene mot konkurransegrunnlaget før dere leverer.',
  ]) {
    w.point({ text: line });
  }

  // Bunntekst med sidetall
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Bunnteksten står i nedre marg – uten dette legger pdfkit til en ny side.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.moveTo(w.left, y - 6).lineTo(w.left + w.width, y - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(safe(`AnbudRadar Intelligence · ${t.title.length > 70 ? `${t.title.slice(0, 67)}…` : t.title}`), w.left, y, { width: w.width - 60, lineBreak: false });
    doc.text(`Side ${i + 1} av ${range.count}`, w.left + w.width - 60, y, { width: 60, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}
