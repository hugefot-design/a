import { CERTIFICATIONS, COMPANY_SIZES, CONTRACT_NATURES, INDUSTRIES, REGIONS } from '@/domain/reference';
import { MAX_REFERENCES, type CompanyProfile, type profileFormFromData } from '@/domain/profile/profile';
import { Alert, Button, Checkbox, Field, Input, Panel, PostForm, Select, Textarea } from '../../components';
import { AppShell, AuthLayout } from '../../layouts';

type Errors = Record<string, string>;
type Values = Partial<Record<string, string | string[]>>;

export function profileToValues(p: CompanyProfile | null, orgName?: string): Values {
  if (!p) return { companyName: orgName ?? '', regions: [], industries: [], minDaysToDeadline: '10' };
  return {
    companyName: p.companyName,
    orgNumber: p.orgNumber ?? '',
    description: p.description ?? '',
    industries: p.industries,
    services: p.services ?? '',
    keywords: p.keywords.join(', '),
    cpvCodes: p.cpvCodes.join(', '),
    regions: p.regions,
    companySize: p.companySize ?? '',
    certifications: p.certifications,
    experience: p.experience ?? '',
    minContractValue: p.minContractValue !== null ? String(p.minContractValue) : '',
    maxContractValue: p.maxContractValue !== null ? String(p.maxContractValue) : '',
    contractTypes: p.contractTypes,
    excludedCpv: p.excludedCpv.join(', '),
    excludedKeywords: p.excludedKeywords.join(', '),
    minDaysToDeadline: String(p.minDaysToDeadline),
    products: p.products ?? '',
    competencies: p.competencies ?? '',
    employeeCount: p.employeeCount !== null && p.employeeCount !== undefined ? String(p.employeeCount) : '',
    annualRevenue: p.annualRevenue !== null && p.annualRevenue !== undefined ? String(Math.round(p.annualRevenue)) : '',
    ...referenceValues(
      (p.referenceProjects ?? []).map((r) => ({
        title: r.title,
        client: r.client ?? '',
        year: r.year !== null ? String(r.year) : '',
        value: r.value !== null ? String(Math.round(r.value)) : '',
        description: r.description ?? '',
      })),
    ),
  };
}

type RefStrings = { title: string; client: string; year: string; value: string; description: string };

function referenceValues(refs: RefStrings[]): Values {
  const out: Values = {};
  refs.slice(0, MAX_REFERENCES).forEach((r, i) => {
    out[`ref_title_${i}`] = r.title;
    out[`ref_client_${i}`] = r.client;
    out[`ref_year_${i}`] = r.year;
    out[`ref_value_${i}`] = r.value;
    out[`ref_description_${i}`] = r.description;
  });
  return out;
}

/** Skjemaverdier tilbake til skjemaet etter valideringsfeil (referansene flates ut til feltnavn). */
export function formValues(raw: ReturnType<typeof profileFormFromData>): Values {
  const { referenceProjects, ...rest } = raw;
  return { ...rest, ...referenceValues(referenceProjects) };
}

function str(v: Values, k: string): string {
  const x = v[k];
  return typeof x === 'string' ? x : '';
}
function arr(v: Values, k: string): string[] {
  const x = v[k];
  return Array.isArray(x) ? x : [];
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid grid-cols-1 gap-5 border-t border-line pt-6 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="font-semibold text-navy-900">{title}</p>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </fieldset>
  );
}

export function ProfileFields({ values, errors, readOnly = false }: { values: Values; errors: Errors; readOnly?: boolean }) {
  const industries = arr(values, 'industries');
  const regions = arr(values, 'regions');
  const certs = arr(values, 'certifications');
  const types = arr(values, 'contractTypes');
  return (
    <fieldset disabled={readOnly} className="space-y-6">
      <Section title="Bedriften" description="Brukes i oversikten og som utgangspunkt for tilbudsutkast.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Firmanavn" htmlFor="companyName" error={errors.companyName}>
            <Input id="companyName" name="companyName" required defaultValue={str(values, 'companyName')} invalid={Boolean(errors.companyName)} />
          </Field>
          <Field label="Organisasjonsnummer" htmlFor="orgNumber" hint="Valgfritt, 9 siffer." error={errors.orgNumber}>
            <Input id="orgNumber" name="orgNumber" inputMode="numeric" defaultValue={str(values, 'orgNumber')} invalid={Boolean(errors.orgNumber)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field label="Antall ansatte" htmlFor="employeeCount" hint="Valgfritt, eksakt tall." error={errors.employeeCount}>
            <Input id="employeeCount" name="employeeCount" inputMode="numeric" defaultValue={str(values, 'employeeCount')} invalid={Boolean(errors.employeeCount)} />
          </Field>
          <Field label="… eller størrelse" htmlFor="companySize">
            <Select id="companySize" name="companySize" defaultValue={str(values, 'companySize')}>
              <option value="">Velg</option>
              {Object.entries(COMPANY_SIZES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Årlig omsetning (kr)" htmlFor="annualRevenue" hint="Siste regnskapsår. Brukes mot krav til økonomi." error={errors.annualRevenue}>
            <Input id="annualRevenue" name="annualRevenue" inputMode="numeric" defaultValue={str(values, 'annualRevenue')} invalid={Boolean(errors.annualRevenue)} />
          </Field>
        </div>
        <Field label="Kort om bedriften" htmlFor="description" error={errors.description}>
          <Textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={str(values, 'description')} />
        </Field>
      </Section>

      <Section title="Hva dere leverer" description="Avgjør hvilke anbud som rangeres høyest for dere.">
        <div>
          <p className="mb-2 text-[13px] font-semibold">Bransjer</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {INDUSTRIES.map((i) => (
              <Checkbox key={i.id} name="industries" value={i.id} defaultChecked={industries.includes(i.id)} label={i.name} />
            ))}
          </div>
          {errors.industries ? <p className="mt-1 text-[13px] font-medium text-danger">{errors.industries}</p> : null}
        </div>
        <Field label="Tjenester" htmlFor="services" hint="Beskriv med egne ord, f.eks. «stasjonært vakthold, alarmmottak og resepsjonstjenester».">
          <Textarea id="services" name="services" rows={3} maxLength={3000} defaultValue={str(values, 'services')} />
        </Field>
        <Field label="Produkter (valgfritt)" htmlFor="products" hint="Varer og utstyr dere leverer, f.eks. «adgangskontroll, kameraer, låssystemer».">
          <Textarea id="products" name="products" rows={2} maxLength={3000} defaultValue={str(values, 'products')} />
        </Field>
        <Field label="Kompetanse (valgfritt)" htmlFor="competencies" hint="Fagområder, metoder, roller og sertifiserte personer. Brukes i egnethetsvurdering og tilbudsutkast.">
          <Textarea id="competencies" name="competencies" rows={2} maxLength={3000} defaultValue={str(values, 'competencies')} />
        </Field>
        <Field label="Nøkkelord" htmlFor="keywords" hint="Skill med komma. Brukes til å finne anbud som nevner ordene.">
          <Input id="keywords" name="keywords" defaultValue={str(values, 'keywords')} />
        </Field>
        <Field label="CPV-koder (valgfritt)" htmlFor="cpvCodes" hint="Skill med komma, f.eks. 79713000. Gir mer presis rangering." error={errors.cpvCodes}>
          <Input id="cpvCodes" name="cpvCodes" defaultValue={str(values, 'cpvCodes')} />
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-semibold">Kontraktstyper dere ønsker</p>
          <div className="flex flex-wrap gap-4">
            {Object.entries(CONTRACT_NATURES).map(([k, label]) => (
              <Checkbox key={k} name="contractTypes" value={k} defaultChecked={types.includes(k)} label={label} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Område" description="Fylker dere kan levere i. Anbud utenfor området rangeres lavere.">
        <Checkbox name="regions" value="ALL" defaultChecked={regions.includes('ALL')} label="Hele landet" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {REGIONS.map((r) => (
            <Checkbox key={r.code} name="regions" value={r.code} defaultChecked={regions.includes(r.code)} label={r.name} />
          ))}
        </div>
        {errors.regions ? <p className="text-[13px] font-medium text-danger">{errors.regions}</p> : null}
      </Section>

      <Section title="Kontraktsstørrelse og frister">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field label="Minste verdi (kr)" htmlFor="minContractValue" error={errors.minContractValue}>
            <Input id="minContractValue" name="minContractValue" inputMode="numeric" defaultValue={str(values, 'minContractValue')} />
          </Field>
          <Field label="Største verdi (kr)" htmlFor="maxContractValue" error={errors.maxContractValue}>
            <Input id="maxContractValue" name="maxContractValue" inputMode="numeric" defaultValue={str(values, 'maxContractValue')} />
          </Field>
          <Field label="Minst antall dager til frist" htmlFor="minDaysToDeadline" error={errors.minDaysToDeadline}>
            <Input id="minDaysToDeadline" name="minDaysToDeadline" type="number" min={0} max={120} defaultValue={str(values, 'minDaysToDeadline') || '10'} />
          </Field>
        </div>
      </Section>

      <Section
        title="Kvalifikasjoner"
        description="Kryss bare av det dere faktisk kan dokumentere. Tilbudsassistenten bruker dette og finner aldri på noe selv."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CERTIFICATIONS.map((c) => (
            <Checkbox key={c.id} name="certifications" value={c.id} defaultChecked={certs.includes(c.id)} label={c.label} />
          ))}
        </div>
        <Field label="Relevant erfaring" htmlFor="experience" hint="Faktiske oppdrag, kunder og resultater med egne ord. Brukes i tilbudsutkast.">
          <Textarea id="experience" name="experience" rows={4} maxLength={5000} defaultValue={str(values, 'experience')} />
        </Field>
      </Section>

      <Section
        title="Referanseprosjekter"
        description={`Inntil ${MAX_REFERENCES} oppdrag dere kan dokumentere. Mange anbud krever referanser fra tilsvarende oppdrag.`}
      >
        {Array.from({ length: MAX_REFERENCES }, (_, i) => (
          <div key={i} className="rounded-md border border-line p-4">
            <p className="mb-3 text-[13px] font-semibold text-navy-900">Referanse {i + 1}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_6rem_minmax(0,1fr)]">
              <Field label="Oppdrag" htmlFor={`ref_title_${i}`}>
                <Input id={`ref_title_${i}`} name={`ref_title_${i}`} maxLength={200} defaultValue={str(values, `ref_title_${i}`)} />
              </Field>
              <Field label="Kunde" htmlFor={`ref_client_${i}`}>
                <Input id={`ref_client_${i}`} name={`ref_client_${i}`} maxLength={200} defaultValue={str(values, `ref_client_${i}`)} />
              </Field>
              <Field label="År" htmlFor={`ref_year_${i}`} error={errors[`referenceProjects.${i}.year`]}>
                <Input id={`ref_year_${i}`} name={`ref_year_${i}`} inputMode="numeric" maxLength={4} defaultValue={str(values, `ref_year_${i}`)} />
              </Field>
              <Field label="Verdi (kr)" htmlFor={`ref_value_${i}`} error={errors[`referenceProjects.${i}.value`]}>
                <Input id={`ref_value_${i}`} name={`ref_value_${i}`} inputMode="numeric" defaultValue={str(values, `ref_value_${i}`)} />
              </Field>
            </div>
            <Field label="Kort beskrivelse" htmlFor={`ref_description_${i}`} className="mt-3">
              <Textarea id={`ref_description_${i}`} name={`ref_description_${i}`} rows={2} maxLength={1500} defaultValue={str(values, `ref_description_${i}`)} />
            </Field>
          </div>
        ))}
      </Section>

      <Section title="Ekskluderinger" description="Anbud som treffer disse, skjules fra anbefalinger og varsler.">
        <Field label="Ekskluder CPV-koder" htmlFor="excludedCpv" hint="Skill med komma.">
          <Input id="excludedCpv" name="excludedCpv" defaultValue={str(values, 'excludedCpv')} />
        </Field>
        <Field label="Ekskluder ord" htmlFor="excludedKeywords" hint="Skill med komma, f.eks. «kantine, catering».">
          <Input id="excludedKeywords" name="excludedKeywords" defaultValue={str(values, 'excludedKeywords')} />
        </Field>
      </Section>
    </fieldset>
  );
}

export function OnboardingOrgPage({
  errors = {},
  values = {},
  carry,
}: {
  errors?: Errors;
  values?: Values;
  /** Bransje og fylke fra forsiden, som tas med videre til profilen. */
  carry?: { industry: string | null; region: string | null };
}) {
  return (
    <AuthLayout title="Om bedriften" intro="Steg 1 av 2. Vi oppretter en organisasjon som dere kan dele med kolleger.">
      <PostForm action="/app/onboarding/organisasjon" className="space-y-4">
        {carry?.industry ? <input type="hidden" name="bransje" value={carry.industry} /> : null}
        {carry?.region ? <input type="hidden" name="fylke" value={carry.region} /> : null}
        <Field label="Firmanavn" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" required defaultValue={str(values, 'name')} invalid={Boolean(errors.name)} autoComplete="organization" />
        </Field>
        <Field label="Organisasjonsnummer" htmlFor="orgNumber" hint="Valgfritt." error={errors.orgNumber}>
          <Input id="orgNumber" name="orgNumber" inputMode="numeric" defaultValue={str(values, 'orgNumber')} invalid={Boolean(errors.orgNumber)} />
        </Field>
        <Button type="submit" className="w-full">
          Fortsett
        </Button>
      </PostForm>
    </AuthLayout>
  );
}

export function OnboardingProfilePage({ values, errors = {} }: { values: Values; errors?: Errors }) {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <p className="text-[13px] font-semibold text-muted">Steg 2 av 2</p>
        <h1 className="mt-1 font-serif text-[28px] font-semibold text-navy-900">Fortell oss hva dere leverer</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Svarene brukes til å rangere anbud for dere. Dere kan endre alt senere under Bedriftsprofil.
        </p>
        {Object.keys(errors).length ? (
          <Alert tone="danger" className="mt-5">
            Noen felt må rettes. Se meldingene under.
          </Alert>
        ) : null}
        <Panel className="mt-6 p-5 sm:p-7">
          <PostForm action="/app/onboarding/profil" className="space-y-8">
            <ProfileFields values={values} errors={errors} />
            <div className="flex justify-end border-t border-line pt-5">
              <Button type="submit" size="lg" busyLabel="Finner anbud …">
                Lagre og finn anbud
              </Button>
            </div>
          </PostForm>
        </Panel>
      </div>
    </AppShell>
  );
}

export function ProfilePage({ values, errors = {}, canEdit, matchCount }: { values: Values; errors?: Errors; canEdit: boolean; matchCount: number | null }) {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="font-serif text-[28px] font-semibold text-navy-900">Bedriftsprofil</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Profilen styrer rangering, varsler og tilbudsassistenten.
          {matchCount !== null ? ` Akkurat nå passer ${matchCount} åpne anbud profilen.` : ''}
        </p>
        {!canEdit ? (
          <Alert tone="info" className="mt-5">
            Bare eiere og administratorer kan endre profilen.
          </Alert>
        ) : null}
        {Object.keys(errors).length ? (
          <Alert tone="danger" className="mt-5">
            Noen felt må rettes. Se meldingene under.
          </Alert>
        ) : null}
        <Panel className="mt-6 p-5 sm:p-7">
          <PostForm action="/app/profil" className="space-y-8">
            <ProfileFields values={values} errors={errors} readOnly={!canEdit} />
            {canEdit ? (
              <div className="flex justify-end border-t border-line pt-5">
                <Button type="submit" busyLabel="Lagrer …">
                  Lagre profil
                </Button>
              </div>
            ) : null}
          </PostForm>
        </Panel>
      </div>
    </AppShell>
  );
}
