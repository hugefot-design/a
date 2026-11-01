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

export const tenderAnalysisJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'purchase_description',
    'key_requirements',
    'qualification_criteria',
    'certifications',
    'financial_requirements',
    'deadline',
    'contract_duration',
    'geographic_requirements',
    'evaluation_criteria',
    'required_documentation',
    'risks',
    'questions_to_investigate',
    'missing_information',
  ],
  properties: {
    summary: { type: 'string', description: 'Sammendrag på enkel norsk, 3–5 setninger.' },
    purchase_description: { type: 'string', description: 'Hva oppdragsgiver vil kjøpe, konkret.' },
    key_requirements: { type: 'array', items: sourcedItem },
    qualification_criteria: { type: 'array', items: sourcedItem },
    certifications: { type: 'array', items: sourcedItem },
    financial_requirements: { type: 'array', items: sourcedItem },
    deadline: sourcedValue,
    contract_duration: sourcedValue,
    geographic_requirements: { type: 'array', items: sourcedItem },
    evaluation_criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'weight', 'source'],
        properties: { criterion: { type: 'string' }, weight: { type: ['string', 'null'] }, source: sourceRef },
      },
    },
    required_documentation: { type: 'array', items: sourcedItem },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: { text: { type: 'string' }, source: nullableSourceRef },
      },
    },
    questions_to_investigate: { type: 'array', items: { type: 'string' } },
    missing_information: { type: 'array', items: { type: 'string' } },
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

export const tenderAnalysisZ = z.object({
  summary: z.string().min(1).max(3000),
  purchase_description: z.string().max(3000),
  key_requirements: z.array(sourcedItemZ).max(40),
  qualification_criteria: z.array(sourcedItemZ).max(40),
  certifications: z.array(sourcedItemZ).max(30),
  financial_requirements: z.array(sourcedItemZ).max(20),
  deadline: z.object({ value: z.string().max(300).nullable(), source: sourceRefZ.nullable() }),
  contract_duration: z.object({ value: z.string().max(300).nullable(), source: sourceRefZ.nullable() }),
  geographic_requirements: z.array(sourcedItemZ).max(20),
  evaluation_criteria: z.array(z.object({ criterion: z.string().max(500), weight: z.string().max(100).nullable(), source: sourceRefZ })).max(20),
  required_documentation: z.array(sourcedItemZ).max(40),
  risks: z.array(z.object({ text: z.string().max(1000), source: sourceRefZ.nullable() })).max(20),
  questions_to_investigate: z.array(z.string().max(500)).max(20),
  missing_information: z.array(z.string().max(500)).max(30),
});
export type TenderAnalysis = z.infer<typeof tenderAnalysisZ>;

export const basicSummaryZ = z.object({
  summary: z.string().min(1).max(3000),
  purchase_description: z.string().max(3000),
  missing_information: z.array(z.string().max(500)).max(30),
});
export type BasicSummary = z.infer<typeof basicSummaryZ>;

// ---------------------------------------------------------------------------
// Tilbudsassistent
// ---------------------------------------------------------------------------
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
