import type { InvitationRow, MemberRow } from '@/domain/org/org';
import { useUi } from '../../context';
import { Alert, Badge, Button, buttonVariants, Field, Input, PageHeader, Panel, PanelHeader, PostForm, Select, Tabs } from '../../components';
import { AppShell } from '../../layouts';
import { formatDate, relativeTime } from '../../format';
import { LuMonitor, LuMoon, LuSun } from 'react-icons/lu';
import { describeDevice } from '@/lib/device';

const ROLE_LABELS: Record<string, string> = { owner: 'Eier', admin: 'Administrator', member: 'Medlem' };

export interface SettingsProps {
  tab: 'konto' | 'team' | 'personvern' | 'organisasjon';
  members: MemberRow[];
  invitations: InvitationRow[];
  sessions: { id: string; userAgent: string | null; createdAt: Date; lastSeenAt: Date; current: boolean }[];
  errors?: Record<string, string>;
  audit: { action: string; createdAt: Date; actorName: string | null }[];
}

export function SettingsPage(p: SettingsProps) {
  const { user, org } = useUi();
  const canManage = org?.role === 'owner' || org?.role === 'admin';
  const errors = p.errors ?? {};
  return (
    <AppShell>
      <PageHeader title="Innstillinger" />
      <Tabs
        items={[
          { href: '/app/innstillinger', label: 'Konto', active: p.tab === 'konto' },
          { href: '/app/innstillinger?fane=team', label: 'Team', active: p.tab === 'team' },
          { href: '/app/innstillinger?fane=organisasjon', label: 'Organisasjon', active: p.tab === 'organisasjon' },
          { href: '/app/innstillinger?fane=personvern', label: 'Personvern og data', active: p.tab === 'personvern' },
        ]}
      />

      {p.tab === 'konto' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Profil" />
            <PostForm action="/app/innstillinger/konto" className="space-y-4 p-5">
              <Field label="Navn" htmlFor="name" error={errors.name}>
                <Input id="name" name="name" defaultValue={user?.name} required maxLength={120} />
              </Field>
              <Field label="E-post" htmlFor="email" hint="Kontakt oss hvis du må bytte e-postadresse.">
                <Input id="email" value={user?.email} disabled readOnly />
              </Field>
              <Button size="sm">Lagre</Button>
            </PostForm>
          </Panel>
          <Panel>
            <PanelHeader title="Bytt passord" description="Andre innloggede enheter logges ut." />
            <PostForm action="/app/innstillinger/passord" className="space-y-4 p-5">
              <Field label="Nåværende passord" htmlFor="currentPassword" error={errors.currentPassword}>
                <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="Nytt passord" htmlFor="newPassword" hint="Minst 10 tegn." error={errors.newPassword}>
                <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} />
              </Field>
              <Button size="sm">Bytt passord</Button>
            </PostForm>
          </Panel>
          <Panel>
            <PanelHeader
              title="Totrinnsinnlogging"
              description="En kode fra telefonen i tillegg til passordet. Da hjelper det ikke å kjenne passordet alene."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <span className={user?.totpEnabled ? 'text-[14px] font-semibold text-ok' : 'text-[14px] text-muted'}>
                {user?.totpEnabled ? 'Slått på' : user?.isPlatformAdmin ? 'Påkrevd for administratorer' : 'Ikke slått på'}
              </span>
              <a href="/konto/totrinn" className={buttonVariants({ size: 'sm', variant: user?.totpEnabled ? 'secondary' : 'primary' })}>
                {user?.totpEnabled ? 'Administrer' : 'Slå på'}
              </a>
            </div>
          </Panel>
          <Panel className="js-only">
            <PanelHeader title="Utseende" description="Automatisk følger innstillingen på enheten. Valget lagres bare i denne nettleseren." />
            <fieldset className="grid grid-cols-3 gap-2 p-5">
              <legend className="sr-only">Fargetema</legend>
              {(
                [
                  ['system', 'Automatisk', LuMonitor],
                  ['light', 'Lys', LuSun],
                  ['dark', 'Mørk', LuMoon],
                ] as const
              ).map(([value, label, Icon]) => (
                <label
                  key={value}
                  className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-line-strong px-2 py-3 text-[13px] font-semibold text-ink transition-colors hover:border-strong has-checked:border-strong has-checked:bg-strong/5 has-focus-visible:ring-4 has-focus-visible:ring-signal/30"
                >
                  <input type="radio" name="tema" value={value} data-theme-choice className="sr-only" />
                  <Icon className="size-5" aria-hidden />
                  {label}
                </label>
              ))}
            </fieldset>
          </Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader
              title="Innloggede enheter"
              action={
                p.sessions.length > 1 ? (
                  <PostForm action="/app/innstillinger/logg-ut-andre">
                    <Button size="sm" variant="secondary">
                      Logg ut andre enheter
                    </Button>
                  </PostForm>
                ) : null
              }
            />
            <ul className="divide-y divide-line">
              {p.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px]">
                  <span className="min-w-0 truncate" title={s.userAgent ?? undefined}>
                    {s.userAgent ? describeDevice(s.userAgent).label : 'Ukjent nettleser'}
                  </span>
                  <span className="text-[13px] text-muted">
                    {s.current ? <Badge tone="ok">Denne enheten</Badge> : `Sist aktiv ${relativeTime(s.lastSeenAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {p.tab === 'team' ? (
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Medlemmer"
              description={`Planen har plass til ${org!.entitlements.maxMembers} ${org!.entitlements.maxMembers === 1 ? 'bruker' : 'brukere'}.`}
            />
            <ul className="divide-y divide-line">
              {p.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">
                      {m.name} {m.userId === user?.id ? <span className="text-[12px] font-normal text-muted">(deg)</span> : null}
                    </p>
                    <p className="text-[13px] text-muted">{m.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canManage && m.userId !== user?.id ? (
                      <PostForm action={`/app/team/${m.userId}/rolle`} className="flex items-center gap-2">
                        <label htmlFor={`role-${m.userId}`} className="sr-only">
                          Rolle for {m.name}
                        </label>
                        <Select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="h-9 w-40 py-0">
                          {(org!.role === 'owner' ? ['owner', 'admin', 'member'] : ['admin', 'member']).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" variant="secondary">
                          Endre
                        </Button>
                      </PostForm>
                    ) : (
                      <Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {(canManage && m.userId !== user?.id) || (m.userId === user?.id && m.role !== 'owner') ? (
                      <PostForm action={`/app/team/${m.userId}/fjern`} confirm={m.userId === user?.id ? 'Forlate organisasjonen?' : `Fjerne ${m.name}?`}>
                        <Button size="sm" variant="danger">
                          {m.userId === user?.id ? 'Forlat' : 'Fjern'}
                        </Button>
                      </PostForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          {canManage ? (
            <Panel>
              <PanelHeader title="Inviter kollega" description="Invitasjonen sendes på e-post og gjelder i 7 dager." />
              <PostForm action="/app/team/inviter" className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
                <Field label="E-post" htmlFor="inv-email" className="flex-1" error={errors.invite}>
                  <Input id="inv-email" name="email" type="email" required />
                </Field>
                <Field label="Rolle" htmlFor="inv-role">
                  <Select id="inv-role" name="role" defaultValue="member">
                    <option value="member">Medlem</option>
                    <option value="admin">Administrator</option>
                  </Select>
                </Field>
                <Button>Send invitasjon</Button>
              </PostForm>
              {p.invitations.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {p.invitations.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
                      <span>
                        {i.email} <span className="text-muted">({ROLE_LABELS[i.role]}, utløper {formatDate(i.expiresAt)})</span>
                      </span>
                      <PostForm action={`/app/team/invitasjon/${i.id}/trekk`}>
                        <Button size="sm" variant="ghost">
                          Trekk tilbake
                        </Button>
                      </PostForm>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}
          {canManage && p.audit.length ? (
            <Panel>
              <PanelHeader title="Siste hendelser" description="Revisjonslogg for organisasjonen." />
              <ul className="divide-y divide-line text-[13px]">
                {p.audit.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3 px-5 py-2">
                    <span>
                      {a.action}
                      {a.actorName ? <span className="text-muted"> – {a.actorName}</span> : null}
                    </span>
                    <span className="text-muted">{relativeTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {p.tab === 'organisasjon' ? (
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Organisasjon" />
            <div className="space-y-2 p-5 text-[14px]">
              <p>
                <strong>{org!.name}</strong>
              </p>
              <p className="text-muted">Navn og organisasjonsnummer endres under Bedriftsprofil.</p>
            </div>
          </Panel>
          {org!.role === 'owner' ? (
            <Panel className="border-danger/30">
              <PanelHeader title="Slett organisasjonen" description="Sletter profil, lagrede anbud, søk, tilbudsarbeid og dokumenter for alle medlemmer. Kan ikke angres." />
              <PostForm action="/app/innstillinger/slett-organisasjon" className="space-y-3 p-5" confirm="Slette organisasjonen permanent?">
                <Field label={`Skriv «${org!.name}» for å bekrefte`} htmlFor="confirmName" error={errors.confirmName}>
                  <Input id="confirmName" name="confirmName" required autoComplete="off" />
                </Field>
                <Button variant="danger">Slett organisasjonen</Button>
              </PostForm>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {p.tab === 'personvern' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Last ned dataene dine" description="Alt vi har lagret om deg (og organisasjonen hvis du er eier/administrator), som JSON." />
            <div className="p-5">
              <a href="/app/innstillinger/eksport" className="font-semibold">
                Last ned eksport
              </a>
            </div>
          </Panel>
          <Panel className="border-danger/30">
            <PanelHeader title="Slett kontoen" description="Kontoen og personopplysningene dine slettes. Organisasjoner der du er eneste medlem slettes også." />
            <PostForm action="/app/innstillinger/slett-konto" className="space-y-3 p-5" confirm="Slette kontoen permanent?">
              {errors.deleteAccount ? <Alert tone="danger">{errors.deleteAccount}</Alert> : null}
              <Field label="Bekreft med passord" htmlFor="del-password">
                <Input id="del-password" name="password" type="password" required autoComplete="current-password" />
              </Field>
              <Button variant="danger">Slett kontoen min</Button>
            </PostForm>
          </Panel>
        </div>
      ) : null}
    </AppShell>
  );
}
