import { isJsonPointer } from '../openapi/failure-codes.ts';
import { isPinnableUrl, pinnedUrlShape } from '../settings/checked.ts';
import type { TokenRequest } from './token-requests.ts';

export interface TokenRequestIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const outsideTheIssuer =
  'Expected an address under the issuer, with no user name or password, so that the signed JWT goes to no other server';

const notAPointer = 'Expected a JSON Pointer into the answer, such as /access_token';

function pathUnder(issuerPath: string): string {
  return issuerPath.endsWith('/') ? issuerPath : `${issuerPath}/`;
}

export function isUnderTheIssuer(issuer: string, url: string): boolean {
  if (!isPinnableUrl(issuer) || !isPinnableUrl(url)) {
    return false;
  }
  const under = new URL(issuer);
  const asked = new URL(url);
  return (
    asked.origin === under.origin &&
    asked.username === '' &&
    asked.password === '' &&
    (asked.pathname === under.pathname || asked.pathname.startsWith(pathUnder(under.pathname)))
  );
}

function urlIssuesOf(issuer: string, url: string): readonly TokenRequestIssue[] {
  if (!isPinnableUrl(url)) {
    return [{ path: ['url'], issue: pinnedUrlShape }];
  }
  return isUnderTheIssuer(issuer, url) ? [] : [{ path: ['url'], issue: outsideTheIssuer }];
}

function pointerIssuesOf({ issued }: TokenRequest): readonly TokenRequestIssue[] {
  return Object.entries(issued)
    .filter(([, pointer]: readonly [string, string]) => !isJsonPointer(pointer))
    .map(([name]: readonly [string, string]) => ({ path: ['issued', name], issue: notAPointer }));
}

export function tokenRequestIssuesOf(issuer: string, request: TokenRequest): readonly TokenRequestIssue[] {
  return [...urlIssuesOf(issuer, request.url), ...pointerIssuesOf(request)];
}
