import type { Authenticator } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { isMetadataPath } from '../authentication/protected-resource.ts';
import { servesStudioAt, type ApiStudio } from '../studio/served-studio.ts';

export type IsPublic = (path: string) => boolean;

export interface PublicPaths {
  readonly add: (path: string) => void;
  readonly has: IsPublic;
}

const parameter = /^:\w+$/u;

export function pathMatcherOf(path: string): IsPublic {
  const segments = path.split('/').map((segment) => (parameter.test(segment) ? '[^/]+' : RegExp.escape(segment)));
  const pattern = new RegExp(`^${segments.join('/')}$`, 'u');
  return (candidate) => pattern.test(candidate);
}

export function publicPathsKept(): PublicPaths {
  const paths = new Set<string>();
  const patterns: IsPublic[] = [];
  return {
    add: (path) => {
      if (path.includes('/:')) {
        patterns.push(pathMatcherOf(path));
      } else {
        paths.add(path);
      }
    },
    has: (path) => paths.has(path) || patterns.some((matches) => matches(path)),
  };
}

export function publicPathsOf({ resource }: Authenticator, isListed: IsPublic): IsPublic {
  return (path) => isListed(path) || (resource !== undefined && isMetadataPath(path));
}

export function needingNoCallerOf(isPublic: IsPublic, studio: ApiStudio): IsPublic {
  const servesStudio = servesStudioAt(studio);
  return (path) => isPublic(path) || servesStudio(path);
}

export function exceptOn(isPublic: IsPublic, middleware: MiddlewareHandler<ApiEnv>): MiddlewareHandler<ApiEnv> {
  return (c, next) => (isPublic(c.req.path) ? next() : middleware(c, next));
}
