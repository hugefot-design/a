import { z } from 'zod';
import type { JsonSchema } from './provider';

// ---------------------------------------------------------------------------
// Felles byggesteiner (JSON Schema, kompatibelt med OpenAI "strict" og Anthropic tool input)
// ---------------------------------------------------------------------------
const sourceRef: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source_id', 'page', 'quote'],
  properties: {
    source_id: { type: 'string', description: 'Kilde-ID, f.eks. "S0" (kunngjøringen) eller "D1" (dokument 1).' },
    page: { type: ['integer', 'null'], description: 'Sidetall i dokumentet, eller null hvis ukjent.' },
    quote: { type: ['string', 'null'], description: 'Kort, ordrett sitat (maks 200 tegn) fra kilden som støtter påstanden.' },
  },
};
const nullableSourceRef: JsonSchema = { anyOf: [sourceRef, { type: 'null' }] };
const sourcedItem: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'source'],
  properties: { text: { type: 'string' }, source: sourceRef },
};
const sourcedValue: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'source'],
  properties: { value: { type: ['string', 'null'] }, source: nullableSourceRef },
};

const basis: JsonSchema = {
  type: 'string',
  enum: ['kilde', 'tolkning'],
  description: '«kilde» hvis opplysningen står i kildene (med ordrett sitat), «tolkning» hvis det er din vurdering.',
};
const claim: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'basis', 'source'],
  properties: { text: { type: 'string' }, basis, source: nullableSourceRef },
};

export const REQUIREMENT_CATEGORIES = ['leveranse', 'kvalifikasjon', 'dokumentasjon', 'økonomi', 'sertifisering', 'geografi', 'annet'] as const;

export const tenderAnalysisJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'purchase_description',
    'scope_items',
    'requirements',
    'important_dates',
    'deadline',
    'contract_duration',
    'evaluation_criteria',
    'rejection_risks',
    'how_to_participate',
    'risks',
    'questions_to_investigate',
    'missing_information',
    'documents_not_read',
  ],
  properties: {
    summary: { type: 'string', description: 'Sammendrag på enkel norsk, 3–5 setninger.' },
    purchase_description: { type: 'string', description: 'Hva oppdragsgiver faktisk ønsker å oppnå og kjøpe, konkret.' },
    scope_items: { type: 'array', description: 'Tjenester eller produkter som etterspørres.', items: claim },
    requirements: {
      type: 'array',
      description: 'Krav til leverandøren og leveransen.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'category', 'basis', 'source'],
        properties: {
          text: { type: 'string' },
          category: { type: 'string', enum: [...REQUIREMENT_CATEGORIES] },
          basis,
          source: nullableSourceRef,
        },
      },
    },
    important_dates: {
      type: 'array',
      description: 'Frister og datoer (spørsmålsfrist, befaring, tilbudsfrist, vedståelse, oppstart).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value', 'source'],
        properties: { label: { type: 'string' }, value: { type: 'string' }, source: nullableSourceRef },
      },
    },
    deadline: sourcedValue,
    contract_duration: sourcedValue,
    evaluation_criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'weight', 'source'],
        properties: { criterion: { type: 'string' }, weight: { type: ['string', 'null'] }, source: nullableSourceRef },
      },
    },
    rejection_risks: { type: 'array', description: 'Forhold som kan føre til avvisning av tilbudet.', items: claim },
    how_to_participate: { type: 'array', description: 'Konkrete steg for å kunne delta, i rekkefølge.', items: { type: 'string' } },
    risks: {
      type: 'array',
      description: 'Dine vurderinger av risiko for leverandøren (tolkning).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: { text: { type: 'string' }, source: nullableSourceRef },
      },
    },
    questions_to_investigate: { type: 'array', items: { type: 'string' } },
    missing_information: { type: 'array', items: { type: 'string' } },
    documents_not_read: {
      type: 'array',
      description: 'Dokumenter som nevnes i kildene (f.eks. konkurransegrunnlag, kravspesifikasjon, vedlegg), men som ikke er med i kildene.',
      items: { type: 'string' },
    },
  },
};

export const basicSummaryJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'purchase_description', 'missing_information'],
  properties: {
    summary: { type: 'string' },
    purchase_description: { type: 'string' },
    missing_information: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------------
// Zod-validering av svar
// ---------------------------------------------------------------------------
export const sourceRefZ = z.object({
  source_id: z.string().max(20),
  page: z.number().int().positive().nullable(),
  quote: z.string().max(600).nullable(),
});
const sourcedItemZ = z.object({ text: z.string().min(1).max(2000), source: sourceRefZ });

const basisZ = z.enum(['kilde', 'tolkning']);
const claimZ = z.object({ text: z.string().min(1).max(2000), basis: basisZ, source: sourceRefZ.nullable() });

export const tenderAnalysisZ = z.object({
  summary: z.string().min(1).max(3000),
  purchase_description: z.string().max(3000),
  scope_items: z.array(claimZ).max(40),
  requirements: z
    .array(z.object({ text: z.string().min(1).max(2000), category: z.enum(REQUIREMENT_CATEGORIES), basis: basisZ, source: sourceRefZ.nullable() }))
    .max(80),
  important_dates: z.array(z.object({ label: z.string().max(200), value: z.string().max(300), source: sourceRefZ.nullable() })).max(20),
  deadline: z.object({ value: z.string().max(300).nullable(), source: sourceRefZ.nullable() }),
  contract_duration: z.object({ value: z.string().max(300).nullable(), source: sourceRefZ.nullable() }),
  evaluation_criteria: z.array(z.object({ criterion: z.string().max(500), weight: z.string().max(100).nullable(), source: sourceRefZ.nullable() })).max(20),
  rejection_risks: z.array(claimZ).max(30),
  how_to_participate: z.array(z.string().max(600)).max(20),
  risks: z.array(z.object({ text: z.string().max(1000), source: sourceRefZ.nullable() })).max(20),
  questions_to_investigate: z.array(z.string().max(500)).max(20),
  missing_information: z.array(z.string().max(500)).max(30),
  documents_not_read: z.array(z.string().max(300)).max(30),
});
export type TenderAnalysis = z.infer<typeof tenderAnalysisZ>;

// ---------------------------------------------------------------------------
// Egnethet (bedriftsprofil mot krav)
// ---------------------------------------------------------------------------
export const fitAssessmentJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'fit', 'requirements', 'missing_company_info', 'uncertainty', 'uncertainty_reasons', 'next_steps'],
  properties: {
    overall: { type: 'string', description: 'Kort, nøktern vurdering (2–4 setninger).' },
    fit: { type: 'string', enum: ['god', 'middels', 'svak', 'uklar'] },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'status', 'explanation', 'basis', 'source'],
        properties: {
          requirement: { type: 'string' },
          status: { type: 'string', enum: ['oppfylt', 'ikke_oppfylt', 'uklart'] },
          explanation: { type: 'string', description: 'Hvorfor – med henvisning til opplysninger i bedriftsprofilen.' },
          basis,
          source: nullableSourceRef,
        },
      },
    },
    missing_company_info: { type: 'array', items: { type: 'string' }, description: 'Opplysninger bedriften bør legge inn eller avklare.' },
    uncertainty: { type: 'string', enum: ['lav', 'middels', 'høy'] },
    uncertainty_reasons: { type: 'array', items: { type: 'string' } },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
};
export const fitAssessmentZ = z.object({
  overall: z.string().min(1).max(2000),
  fit: z.enum(['god', 'middels', 'svak', 'uklar']),
  requirements: z
    .array(
      z.object({
        requirement: z.string().min(1).max(1000),
        status: z.enum(['oppfylt', 'ikke_oppfylt', 'uklart']),
        explanation: z.string().max(1000),
        basis: basisZ,
        source: sourceRefZ.nullable(),
      }),
    )
    .max(40),
  missing_company_info: z.array(z.string().max(400)).max(20),
  uncertainty: z.enum(['lav', 'middels', 'høy']),
  uncertainty_reasons: z.array(z.string().max(400)).max(10),
  next_steps: z.array(z.string().max(400)).max(10),
});
export type FitAssessment = z.infer<typeof fitAssessmentZ>;

export const basicSummaryZ = z.object({
  summary: z.string().min(1).max(3000),
  purchase_description: z.string().max(3000),
  missing_information: z.array(z.string().max(500)).max(30),
});
export type BasicSummary = z.infer<typeof basicSummaryZ>;

// ---------------------------------------------------------------------------
// Tilbudsassistent
// ---------------------------------------------------------------------------
export const bidStructureJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'purpose', 'requirements_covered', 'source'],
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string', description: 'Hva kapittelet skal vise og inneholde.' },
          requirements_covered: { type: 'array', items: { type: 'string' } },
          source: nullableSourceRef,
        },
      },
    },
  },
};
export const bidStructureZ = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        purpose: z.string().max(1500),
        requirements_covered: z.array(z.string().max(500)).max(20),
        source: sourceRefZ.nullable(),
      }),
    )
    .min(1)
    .max(20),
});
export type BidStructure = z.infer<typeof bidStructureZ>;

export const bidChecklistJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'category', 'source'],
        properties: {
          label: { type: 'string', description: 'Konkret oppgave, f.eks. "Legg ved skatteattest (ikke eldre enn 6 måneder)".' },
          category: { type: 'string', enum: ['kvalifikasjon', 'dokumentasjon', 'pris', 'løsning', 'frist', 'annet'] },
          source: nullableSourceRef,
        },
      },
    },
  },
};
export const bidChecklistZ = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(500),
        category: z.enum(['kvalifikasjon', 'dokumentasjon', 'pris', 'løsning', 'frist', 'annet']),
        source: sourceRefZ.nullable(),
      }),
    )
    .max(60),
});

export const bidDraftJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['content', 'placeholders', 'profile_facts_used'],
  properties: {
    content: { type: 'string', description: 'Utkast til tekst. Bruk [FYLL INN: ...] der informasjon mangler.' },
    placeholders: { type: 'array', items: { type: 'string' }, description: 'Liste over alt brukeren må fylle inn.' },
    profile_facts_used: { type: 'array', items: { type: 'string' }, description: 'Hvilke opplysninger fra bedriftsprofilen som ble brukt.' },
  },
};
export const bidDraftZ = z.object({
  content: z.string().min(1).max(20_000),
  placeholders: z.array(z.string().max(300)).max(50),
  profile_facts_used: z.array(z.string().max(300)).max(50),
});
export type BidDraft = z.infer<typeof bidDraftZ>;

export const bidReviewJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'overall'],
  properties: {
    overall: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'coverage', 'comment', 'section_title'],
        properties: {
          requirement: { type: 'string' },
          coverage: { type: 'string', enum: ['dekket', 'delvis', 'mangler'] },
          comment: { type: 'string' },
          section_title: { type: ['string', 'null'] },
        },
      },
    },
  },
};
export const bidReviewZ = z.object({
  overall: z.string().max(2000),
  items: z
    .array(
      z.object({
        requirement: z.string().max(1000),
        coverage: z.enum(['dekket', 'delvis', 'mangler']),
        comment: z.string().max(1000),
        section_title: z.string().max(300).nullable(),
      }),
    )
    .max(60),
});
export type BidReview = z.infer<typeof bidReviewZ>;

export const weeklyOverviewJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'points'],
  properties: { headline: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
};
export const weeklyOverviewZ = z.object({ headline: z.string().max(300), points: z.array(z.string().max(500)).max(8) });
export type WeeklyOverview = z.infer<typeof weeklyOverviewZ>;
