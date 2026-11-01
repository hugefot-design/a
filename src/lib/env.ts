import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Leser .env-fil (uten å overskrive variabler som allerede er satt) og validerer
 * konfigurasjonen. Hemmeligheter leses KUN på serveren og sendes aldri til nettleseren.
 */
function loadEnvFile(): void {
  const file = process.env.ENV_FILE ?? (process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Ugyldig .env-fil – valideringen under gir en tydelig feilmelding.
    }
  }
}
loadEnvFile();

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL mangler'),
  DATABASE_ADMIN_URL: z.string().min(1, 'DATABASE_ADMIN_URL mangler'),
  DATABASE_SSL: z.enum(['disable', 'require']).default('disable'),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET må være minst 32 tegn'),
  CRON_SECRET: optionalString,

  AI_PROVIDER: z.enum(['none', 'openai', 'anthropic', 'mock']).default('none'),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  AI_INPUT_PRICE_PER_MTOK_USD: z.coerce.number().nonnegative().default(0),
  AI_OUTPUT_PRICE_PER_MTOK_USD: z.coerce.number().nonnegative().default(0),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(120_000),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default('AnbudRadar <varsler@example.com>'),
  EMAIL_REPLY_TO: optionalString,
  ADMIN_NOTIFICATION_EMAIL: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_STARTER: optionalString,
  STRIPE_PRICE_PROFESSIONAL: optionalString,
  STRIPE_PRICE_BUSINESS: optionalString,
  /** Valgfri fast avgiftssats (txr_…) for 25 % MVA. Alternativt Stripe Tax (STRIPE_AUTOMATIC_TAX=true, koster ekstra). */
  STRIPE_TAX_RATE_ID: optionalString,
  STRIPE_AUTOMATIC_TAX: bool(false),

  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().default('anbudradar'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  TED_API_BASE_URL: z.string().url().default('https://api.ted.europa.eu'),
  DOFFIN_API_BASE_URL: z.string().url().default('https://api.doffin.no/public/v2'),
  DOFFIN_API_KEY: optionalString,
  INGEST_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(120),
  INGEST_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(365).default(14),

  TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(14),
  LEGAL_PAGES_REVIEWED: bool(false),
  COMPANY_LEGAL_NAME: z.string().default('[Selskapsnavn AS]'),
  COMPANY_ORG_NUMBER: z.string().default('[org.nr.]'),
  COMPANY_ADDRESS: z.string().default('[adresse]'),
  COMPANY_CONTACT_EMAIL: z.string().default('kontakt@example.com'),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ugyldig konfigurasjon (se .env.example):\n${issues}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.AI_PROVIDER === 'mock') problems.push('AI_PROVIDER=mock er ikke tillatt i produksjon');
    if (!env.APP_URL.startsWith('https://')) problems.push('APP_URL må bruke https i produksjon');
    if (env.SESSION_SECRET.includes('dev-only')) problems.push('SESSION_SECRET må byttes i produksjon');
    if (!env.CRON_SECRET) problems.push('CRON_SECRET må settes i produksjon');
    if (problems.length) throw new Error(`Ugyldig produksjonskonfigurasjon:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}

export const env: Env = parseEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';

/** Hvilke eksterne integrasjoner som faktisk er konfigurert. Brukes i UI og helsesjekk. */
export function integrationStatus() {
  return {
    ai:
      env.AI_PROVIDER === 'openai'
        ? Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL)
        : env.AI_PROVIDER === 'anthropic'
          ? Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL)
          : env.AI_PROVIDER === 'mock',
    aiProvider: env.AI_PROVIDER,
    aiIsMock: env.AI_PROVIDER === 'mock',
    email: env.EMAIL_PROVIDER === 'resend' ? Boolean(env.RESEND_API_KEY) : false,
    stripe: Boolean(
      env.STRIPE_SECRET_KEY &&
        env.STRIPE_WEBHOOK_SECRET &&
        env.STRIPE_PRICE_STARTER &&
        env.STRIPE_PRICE_PROFESSIONAL &&
        env.STRIPE_PRICE_BUSINESS,
    ),
    stripeTestMode: Boolean(env.STRIPE_SECRET_KEY?.startsWith('sk_test_')),
    storage: env.STORAGE_DRIVER === 'supabase' ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) : true,
    storageDriver: env.STORAGE_DRIVER,
    doffin: Boolean(env.DOFFIN_API_KEY),
    ted: true,
    cron: Boolean(env.CRON_SECRET),
  };
}
