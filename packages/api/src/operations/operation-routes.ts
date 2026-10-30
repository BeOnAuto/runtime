import type { RegisterRoutes } from '../routes.ts';
import { handlerFor, type OperationRoutesOptions } from './operation-handler.ts';
import { routeTableOf } from './route-table.ts';

export function operationRoutes(options: OperationRoutesOptions): RegisterRoutes {
  const table = routeTableOf(options.catalog);
  return (routes) => {
    for (const { registration, path } of table) {
      routes.add(registration.route.method, path, handlerFor(registration, options, routes));
    }
  };
}
