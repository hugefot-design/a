import { systemSql, toJson, type Db } from './db';
import { log } from './logger';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.email_verified'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.sessions_revoked'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.mfa_verified'
  | 'auth.mfa_failed'
  | 'auth.mfa_recovery_used'
  | 'auth.mfa_recovery_regenerated'
  | 'auth.passkey_added'
  | 'auth.passkey_removed'
  | 'org.created'
  | 'org.updated'
  | 'org.member_invited'
  | 'org.invitation_revoked'
  | 'org.member_joined'
  | 'org.member_role_changed'
  | 'org.member_removed'
  | 'org.deleted'
  | 'profile.updated'
  | 'billing.checkout_started'
  | 'billing.subscription_changed'
  | 'billing.payment_failed'
  | 'billing.manual_override'
  | 'data.exported'
  | 'notifications.unsubscribed'
  | 'billing.refund_recorded'
  | 'billing.dispute_opened'
  | 'billing.reconciled'
  | 'account.deleted'
  | 'bid.status_changed'
  | 'admin.import_triggered'
  | 'admin.source_updated'
  | 'admin.report_resolved'
  | 'admin.role_changed'
  | 'profit.economics_updated'
  | 'profit.capacity_updated'
  | 'profit.calculation_saved'
  | 'opportunity.followed'
  | 'profit.calculation_deleted'
  | 'partner.profile_published'
  | 'partner.profile_hidden'
  | 'partner.profile_updated'
  | 'partner.request_sent'
  | 'partner.request_answered'
  | 'partner.request_withdrawn';

export interface AuditEntry {
  action: AuditAction;
  orgId?: string | null;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipHash?: string;
}

/** Skriver revisjonslogg. Feil her skal aldri stoppe brukerens handling. */
export async function audit(entry: AuditEntry, db: Db = systemSql()): Promise<void> {
  try {
    await db`
      insert into audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata, ip_hash)
      values (${entry.orgId ?? null}, ${entry.actorUserId ?? null}, ${entry.action}, ${entry.targetType ?? null},
              ${entry.targetId ?? null}, ${toJson(entry.metadata ?? {})}::text::jsonb, ${entry.ipHash ?? null})
    `;
  } catch (err) {
    log.error('audit_failed', { action: entry.action, err });
  }
}
