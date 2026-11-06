import { Router } from '@/server/router';
import { registerAdminRoutes } from './admin';
import { registerApiRoutes } from './api';
import { registerAuthRoutes } from './auth';
import { registerMfaRoutes } from './mfa';
import { registerAccountRoutes } from './app/account';
import { registerBidRoutes } from './app/bids';
import { registerCompetitorRoutes } from './app/competitors';
import { registerCoreAppRoutes } from './app/core';
import { registerProfitRoutes } from './app/profit';
import { registerOpportunityRoutes } from './app/opportunities';
import { registerPublicRoutes } from './public';
import { registerWebhookRoutes } from './webhooks';

export function buildRouter(): Router {
  const router = new Router();
  registerPublicRoutes(router);
  registerApiRoutes(router);
  registerWebhookRoutes(router);
  registerAuthRoutes(router);
  registerMfaRoutes(router);
  registerCoreAppRoutes(router);
  registerAccountRoutes(router);
  registerBidRoutes(router);
  registerCompetitorRoutes(router);
  registerProfitRoutes(router);
  registerOpportunityRoutes(router);
  registerAdminRoutes(router);
  return router;
}
