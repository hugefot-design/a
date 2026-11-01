/**
 * Laster inn full CPV-liste (koder og tekster) fra CSV.
 *
 * Den offisielle CPV 2008-listen (med norsk tekst) kan lastes ned fra EU (SIMAP / TED),
 * f.eks. som Excel, og lagres som CSV med kolonnene: code;label_en;label_nb
 *
 *   npm run import:cpv -- cpv.csv
 */
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../src/lib/db';
import { parseCsv } from '../src/connectors/manual';
import { cleanCpv } from '../src/domain/tenders/normalize';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Bruk: npm run import:cpv -- <fil.csv>   (kolonner: code, label_en, label_nb)');
    process.exit(2);
  }
  const rows = parseCsv(readFileSync(path, 'utf8'));
  let n = 0;
  const sql = systemSql();
  for (const r of rows) {
    const code = cleanCpv(r.code ?? r.cpv ?? '');
    const en = (r.label_en ?? r.en ?? '').trim();
    if (!code || !en) continue;
    const nb = (r.label_nb ?? r.no ?? r.nb ?? '').trim() || null;
    await sql`
      insert into cpv_codes (code, label_en, label_nb) values (${code}, ${en}, ${nb})
      on conflict (code) do update set label_en = excluded.label_en, label_nb = coalesce(excluded.label_nb, cpv_codes.label_nb)
    `;
    n++;
  }
  console.log(`${n} CPV-koder lastet inn.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
