import type { RegisterRoutes } from '../routes.ts';
import { apiCatalogLinkTo, apiCatalogPath, healthPath } from './public-addresses.ts';

const healthHeaders = { 'cache-control': 'no-store', link: apiCatalogLinkTo(apiCatalogPath) };

export const healthRoutes: RegisterRoutes = (routes) => {
  routes.addPublic('GET', healthPath, (c) => c.json({ status: 'ok' }, 200, healthHeaders));
};
