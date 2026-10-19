import type { Authenticator } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { isMetadataPath } from '../authentication/protected-resource.ts';
import { servesStudioAt, type ApiStudio } from '../studio/served-studio.ts';

export type IsPublic = (path: string) => boolean;

export function publicPathsOf({ resource }: Authenticator, publicPaths: ReadonlySet<string>): IsPublic {
  return (path) => publicPaths.has(path) || (resource !== undefined && isMetadataPath(path));
}

export function needingNoCallerOf(isPublic: IsPublic, studio: ApiStudio): IsPublic {
  const servesStudio = servesStudioAt(studio);
  return (path) => isPublic(path) || servesStudio(path);
}

export function exceptOn(isPublic: IsPublic, middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (isPublic(c.req.path) ? next() : middleware(c, next));
}
