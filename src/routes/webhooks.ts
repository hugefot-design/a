import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { handleStripeEvent, StripeError, verifyStripeSignature } from '@/domain/billing/stripe';
import { runScheduledTask, SCHEDULED_TASKS, type ScheduledTask } from '@/domain/ops/tasks';
import { HttpError, json, type RequestContext } from '@/server/http';
import type { Router } from '@/server/router';

function bearerOk(ctx: RequestContext): boolean {
  const header = ctx.req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(env.CRON_SECRET && token && safeEqual(token, env.CRON_SECRET));
}

export function registerWebhookRoutes(router: Router): void {
  router.post(
    '/api/webhooks/stripe',
    'public',
    async (ctx) => {
      if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Stripe er ikke konfigurert' }, { status: 503 });
      const payload = await ctx.bodyBuffer();
      let event;
      try {
        event = verifyStripeSignature(payload, ctx.req.headers['stripe-signature'] as string | undefined, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        log.warn('stripe_webhook_rejected', { reason: err instanceof Error ? err.message : String(err) });
        return json({ error: 'Ugyldig signatur' }, { status: 400 });
      }
      try {
        const result = await handleStripeEvent(event);
        // En annen prosess behandler samme hendelse akkurat nå – Stripe prøver igjen senere.
        if (result === 'in_progress') return json({ received: true, result }, { status: 409 });
        return json({ received: true, result });
      } catch (err) {
        log.error('stripe_webhook_failed', { type: event.type, id: event.id, err: err instanceof StripeError ? err.message : err });
        // 500 gjør at Stripe prøver på nytt senere.
        return json({ error: 'Behandling feilet' }, { status: 500 });
      }
    },
    { csrf: false, maxBodyMb: 1 },
  );

  // For plattformer uten egen arbeiderprosess (f.eks. Vercel Cron eller ekstern cron-tjeneste).
  router.post(
    '/api/cron/:task',
    'public',
    async (ctx) => {
      if (!bearerOk(ctx)) throw new HttpError(401, 'Ugyldig eller manglende nøkkel.');
      const task = ctx.params.task as ScheduledTask;
      if (!SCHEDULED_TASKS.includes(task)) throw new HttpError(404, 'Ukjent oppgave.');
      const result = await runScheduledTask(task, 'schedule');
      return json({ ok: true, task, result });
    },
    { csrf: false, maxBodyMb: 1 },
  );
}
