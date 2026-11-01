import { Router } from '@/server/router';
import { registerAdminRoutes } from './admin';
import { registerApiRoutes } from './api';
import { registerAuthRoutes } from './auth';
import { registerAccountRoutes } from './app/account';
import { registerBidRoutes } from './app/bids';
import { registerCompetitorRoutes } from './app/competitors';
import { registerCoreAppRoutes } from './app/core';
import { registerPublicRoutes } from './public';
import { registerWebhookRoutes } from './webhooks';

export function buildRouter(): Router {
  const router = new Router();
  registerPublicRoutes(router);
  registerApiRoutes(router);
  registerWebhookRoutes(router);
  registerAuthRoutes(router);
  registerCoreAppRoutes(router);
  registerAccountRoutes(router);
  registerBidRoutes(router);
  registerCompetitorRoutes(router);
  registerAdminRoutes(router);
  return router;
}
