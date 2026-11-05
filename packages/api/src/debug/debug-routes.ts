import type { RegisterRoutes } from '../routes.ts';
import { agentSurfaceOf, type DebugServing } from './agent-surface.ts';
import { debugPageOf } from './debug-page.ts';
import { debugPath } from './debug-path.ts';
import type { DebugStyle } from './debug-style.ts';

export function debugRoutes(serving: DebugServing, { head, headers }: DebugStyle): RegisterRoutes {
  const page = debugPageOf(agentSurfaceOf(serving), head);
  return (routes) => {
    routes.addPublic('GET', debugPath, (c) => c.html(page, 200, headers));
  };
}
