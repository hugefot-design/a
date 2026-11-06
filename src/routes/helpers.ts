import type { SecondFactorInput } from '@/domain/auth/mfa';
import { HttpError, type RequestContext } from '@/server/http';
import { isUuid } from '@/server/router';

export function param(ctx: RequestContext, name: string): string {
  const v = ctx.params[name];
  if (!isUuid(v)) throw new HttpError(404, 'Siden finnes ikke.');
  return v;
}

export function formStr(form: FormData, key: string, max = 10_000): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Andre steg fra et skjema: svaret fra en passkey (JSON), ellers kode eller reservekode. */
export function secondFactorFrom(form: FormData): SecondFactorInput {
  const passkey = formStr(form, 'passkey', 20_000);
  return passkey ? { passkey } : { code: formStr(form, 'code', 20) };
}

export function formBool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === 'on' || v === '1' || v === 'true';
}

export function requireOrg(ctx: RequestContext) {
  if (!ctx.org || !ctx.user) throw new HttpError(403, 'Du må tilhøre en organisasjon.');
  return { org: ctx.org, user: ctx.user };
}

export function requireManager(ctx: RequestContext) {
  const { org, user } = requireOrg(ctx);
  if (org.role !== 'owner' && org.role !== 'admin') throw new HttpError(403, 'Bare eiere og administratorer kan gjøre dette.');
  return { org, user };
}

export function wantsJsonResponse(ctx: RequestContext): boolean {
  return (ctx.req.headers.accept ?? '').includes('application/json');
}
