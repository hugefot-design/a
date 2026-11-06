import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { escapeHtml } from '@/server/render';
import type { ChecklistItem, Section, Workspace } from './bids';

function statusLine(ws: Workspace): string {
  if (ws.status === 'approved' || ws.status === 'submitted') {
    return `Godkjent${ws.approvedByName ? ` av ${ws.approvedByName}` : ''}${ws.approvedAt ? ` ${ws.approvedAt.toISOString().slice(0, 10)}` : ''}`;
  }
  return 'UTKAST – ikke godkjent. Må gjennomgås før innsending.';
}

export function toMarkdown(ws: Workspace, sections: Section[], checklist: ChecklistItem[]): string {
  const lines = [`# ${ws.tenderTitle}`, '', `> ${statusLine(ws)}`, '', `Oppdragsgiver: ${ws.buyerName ?? 'ikke oppgitt'}`, ''];
  for (const s of sections) {
    lines.push(`## ${s.title}`, '');
    if (s.requirement) lines.push(`*Krav: ${s.requirement}*`, '');
    lines.push(s.content.trim() || '_(tom)_', '');
  }
  lines.push('## Sjekkliste', '');
  // Kilden (dokument og side) følger med, så kravet kan slås opp i konkurransegrunnlaget.
  for (const c of checklist) lines.push(`- [${c.isDone ? 'x' : ' '}] ${c.label}${c.sourceRef ? ` (kilde: ${c.sourceRef})` : ''}`);
  return lines.join('\n') + '\n';
}

export function toPrintHtml(ws: Workspace, sections: Section[]): string {
  const body = sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.title)}</h2>${s.requirement ? `<p class="req">Krav: ${escapeHtml(s.requirement)}</p>` : ''}${
          s.content
            .trim()
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
            .join('') || '<p class="empty">(tom)</p>'
        }`,
    )
    .join('\n');
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>${escapeHtml(ws.tenderTitle)}</title>
<style>body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#172033;line-height:1.55}
h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2rem}.status{padding:.5rem .75rem;border:1px solid #c3ccd8;font-family:sans-serif;font-size:.85rem}
.req{font-style:italic;color:#5a677d}.empty{color:#8592a6}@media print{.status{border-color:#000}}</style></head>
<body><h1>${escapeHtml(ws.tenderTitle)}</h1><p class="status">${escapeHtml(statusLine(ws))}</p>
<p>Oppdragsgiver: ${escapeHtml(ws.buyerName ?? 'ikke oppgitt')}</p>${body}</body></html>`;
}

export async function toDocx(ws: Workspace, sections: Section[]): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: ws.tenderTitle, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: statusLine(ws), bold: true })] }),
    new Paragraph({ text: `Oppdragsgiver: ${ws.buyerName ?? 'ikke oppgitt'}` }),
  ];
  for (const s of sections) {
    children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1 }));
    if (s.requirement) children.push(new Paragraph({ children: [new TextRun({ text: `Krav: ${s.requirement}`, italics: true })] }));
    const paragraphs = s.content.trim() ? s.content.trim().split(/\n{2,}/) : ['(tom)'];
    for (const p of paragraphs) {
      const lines = p.split('\n');
      children.push(new Paragraph({ children: lines.map((l, i) => new TextRun({ text: l, break: i > 0 ? 1 : 0 })) }));
    }
  }
  const doc = new Document({ creator: 'AnbudRadar', title: ws.tenderTitle, sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
