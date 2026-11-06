/**
 * Oversettelsene: alle språk har de samme tekstene som norsk (samme nøkler, like lange lister og de
 * samme {plassholderne}), riktige bøyninger for tall, og adressene fungerer begge veier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, localePath, MESSAGES, parseLocalePath, preferredLocale, translateAuthErrors } from '../../src/i18n';
import type { Plural } from '../../src/i18n/format';
import { nb } from '../../src/i18n/messages/nb';
import { registerSchema, zodErrors } from '../../src/domain/auth/auth';
import { INDUSTRIES } from '../../src/domain/reference';
import { LEGAL_DOCS } from '../../src/domain/legal/legal';
import { LOCALE_INFO } from '../../src/i18n/locales';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const isPlural = (v: unknown): v is Plural => typeof v === 'object' && v !== null && !Array.isArray(v) && 'other' in v && typeof (v as Plural).other === 'string';
/** Tekster som er tomme på norsk med vilje, men skal finnes på alle andre språk. */
const EMPTY_IN_NB = new Set(['footer.legalNote', 'footer.translated', 'contact.replyLanguage', 'auth.register.languageNote', 'faq.app.q', 'faq.app.a']);
const SAMPLES = [0, 1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 25, 30, 100, 101, 102, 105, 111, 497, 1000, 1001];

function compare(locale: string, ref: unknown, other: unknown, path: string, errors: string[]): void {
  if (isPlural(ref)) {
    if (!isPlural(other)) return void errors.push(`${locale}:${path} skal ha bøyningsformer`);
    const rules = new Intl.PluralRules(LOCALE_INFO[locale as keyof typeof LOCALE_INFO].intl);
    for (const n of SAMPLES) {
      const cat = rules.select(n) as keyof Plural;
      if (!other[cat]) errors.push(`${locale}:${path} mangler formen «${cat}» (brukes for ${n})`);
    }
    const want = placeholders(ref.other).join();
    for (const [cat, form] of Object.entries(other)) {
      if (typeof form !== 'string' || !form.trim()) errors.push(`${locale}:${path}.${cat} er tom`);
      else if (placeholders(form).some((p) => !want.split(',').includes(p!))) errors.push(`${locale}:${path}.${cat} har ukjent plassholder`);
    }
    if (placeholders(other.other).join() !== want) errors.push(`${locale}:${path}.other skal ha {${want}}`);
    return;
  }
  if (typeof ref === 'string') {
    if (typeof other !== 'string') return void errors.push(`${locale}:${path} skal være tekst`);
    if (ref === '' && locale !== 'nb' && EMPTY_IN_NB.has(path) && !other.trim()) errors.push(`${locale}:${path} mangler`);
    if (ref !== '' && !other.trim()) errors.push(`${locale}:${path} er tom`);
    if (placeholders(ref).join() !== placeholders(other).join()) errors.push(`${locale}:${path}: plassholderne skal være {${placeholders(ref).join('}, {')}}`);
    return;
  }
  if (Array.isArray(ref)) {
    if (!Array.isArray(other) || other.length !== ref.length) return void errors.push(`${locale}:${path} skal ha ${ref.length} elementer`);
    ref.forEach((r, i) => compare(locale, r, other[i], `${path}[${i}]`, errors));
    return;
  }
  if (typeof ref === 'object' && ref !== null) {
    if (typeof other !== 'object' || other === null) return void errors.push(`${locale}:${path} mangler`);
    const a = Object.keys(ref).sort();
    const b = Object.keys(other).sort();
    for (const k of a) if (!b.includes(k)) errors.push(`${locale}:${path}.${k} mangler`);
    for (const k of b) if (!a.includes(k)) errors.push(`${locale}:${path}.${k} finnes ikke på norsk`);
    for (const k of a) if (b.includes(k)) compare(locale, (ref as Record<string, unknown>)[k], (other as Record<string, unknown>)[k], path ? `${path}.${k}` : k, errors);
  }
}

test('alle språk har alle tekstene, med samme plassholdere og riktige bøyninger', () => {
  const errors: string[] = [];
  for (const locale of LOCALES) {
    const m = MESSAGES[locale];
    if (!m) {
      errors.push(`${locale}: mangler oversettelse`);
      continue;
    }
    compare(locale, nb, m, '', errors);
  }
  assert.deepEqual(errors, []);
});

test('alle bransjer og juridiske dokumenter har navn på alle språk', () => {
  for (const locale of LOCALES) {
    const m = MESSAGES[locale]!;
    for (const i of INDUSTRIES) assert.ok(m.industries.names[i.id]?.name, `${locale}: ${i.id}`);
    const legal = m.footer.legalDocs as Record<string, string>;
    for (const d of LEGAL_DOCS) assert.ok(legal[d.href.slice(1)], `${locale}: ${d.href}`);
  }
});

test('adresser: norsk på roten, andre språk med prefiks og engelske navn – begge veier', () => {
  assert.equal(localePath('nb', '/priser'), '/priser');
  assert.equal(localePath('en', '/priser'), '/en/pricing');
  assert.equal(localePath('sv', '/'), '/sv');
  assert.equal(localePath('da', '/registrer?neste=%2Fapp'), '/da/register?neste=%2Fapp');
  assert.equal(localePath('en', '/bransjer/construction'), '/en/industries/construction');
  assert.equal(localePath('en', '/bransjer#it'), '/en/industries#it');
  assert.equal(localePath('en', '/personvern'), '/personvern', 'juridiske dokumenter er bare på norsk');
  assert.equal(localePath('en', '/app'), '/app');
  for (const locale of LOCALES) {
    for (const path of ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt', '/registrer', '/logg-inn', '/glemt-passord']) {
      const href = localePath(locale, path);
      assert.deepEqual(parseLocalePath(href), { locale, path }, href);
    }
  }
  assert.deepEqual(parseLocalePath('/en/'), { locale: 'en', path: '/' });
  assert.deepEqual(parseLocalePath('/en/pricing/'), { locale: 'en', path: '/priser' });
  assert.deepEqual(parseLocalePath('/en/app'), { locale: 'en', path: null });
  assert.deepEqual(parseLocalePath('/en/pricing/x'), { locale: 'en', path: null });
  assert.deepEqual(parseLocalePath('/en/industries/it'), { locale: 'en', path: '/bransjer/it' });
  assert.deepEqual(parseLocalePath('/de/pricing'), { locale: 'nb', path: '/de/pricing' }, 'språk som ikke er med, gir vanlig 404');
  assert.deepEqual(parseLocalePath('/nb/priser'), { locale: 'nb', path: '/nb/priser' }, 'norsk har ikke prefiks');
  assert.deepEqual(parseLocalePath('/app/anbud'), { locale: 'nb', path: '/app/anbud' });
  assert.deepEqual(parseLocalePath('/om'), { locale: 'nb', path: '/om' });
});

test('nettleserens språk: beste støttede, norsk for no/nn/nb', () => {
  assert.equal(preferredLocale('en-US,en;q=0.9'), 'en');
  assert.equal(preferredLocale('nn-NO,en;q=0.5'), 'nb');
  assert.equal(preferredLocale('ru-RU,da;q=0.8,en;q=0.5'), 'da');
  assert.equal(preferredLocale('pl-PL,en;q=0.7'), 'en', 'språk vi ikke har, hoppes over');
  assert.equal(preferredLocale('de;q=0.5,sv;q=0.9'), 'sv');
  assert.equal(preferredLocale('ja-JP'), null);
  assert.equal(preferredLocale(''), null);
});

test('feilmeldingene fra registreringen kan oversettes', () => {
  const parsed = registerSchema.safeParse({ name: '', email: 'ikke-epost', password: 'kort', acceptTerms: undefined });
  assert.equal(parsed.success, false);
  const errors = zodErrors(parsed.error!);
  const known = new Set(Object.values(nb.auth.errors));
  for (const text of Object.values(errors)) assert.ok(known.has(text), `«${text}» mangler i nb.auth.errors`);
  for (const locale of LOCALES) {
    const translated = translateAuthErrors(MESSAGES[locale]!, errors);
    for (const [field, text] of Object.entries(translated)) {
      assert.ok(text, `${locale}: ${field}`);
      if (locale !== 'nb') assert.notEqual(text, errors[field], `${locale}: ${field} er ikke oversatt`);
    }
  }
});
