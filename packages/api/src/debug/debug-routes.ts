import type { RegisterRoutes } from '../routes.ts';
import { agentSurfaceOf, type DebugServing } from './agent-surface.ts';
import { debugPageOf } from './debug-page.ts';
import { debugPath } from './debug-path.ts';
import type { DebugStyle } from './debug-style.ts';

export interface DebugPageAnswer {
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function debugRoutes(serving: DebugServing, { head, headers }: DebugStyle): RegisterRoutes {
  const page = debugPageOf(agentSurfaceOf(serving), head);
  return (routes) => {
    routes.addPublic('GET', debugPath, (c) => c.html(page, 200, headers));
  };
}

export async function debugPageAnswerOf(
  serving: DebugServing,
  { head, headers }: DebugStyle,
): Promise<DebugPageAnswer> {
  const page = await debugPageOf(agentSurfaceOf(serving), head);
  return { html: page.toString(), headers: { 'content-type': 'text/html; charset=UTF-8', ...headers } };
}
