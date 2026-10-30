import { Redacted } from 'effect';

import type { ApiDocument, Operation, SecurityRequirement, SecurityScheme } from './api-document.ts';

type Placing =
  | { readonly kind: 'header' | 'query'; readonly name: string }
  | { readonly kind: 'bearer' | 'basic' }
  | { readonly kind: 'token' };

export type Placement =
  | { readonly kind: 'header' | 'query'; readonly name: string; readonly value: Redacted.Redacted }
  | { readonly kind: 'bearer' | 'basic'; readonly value: Redacted.Redacted }
  | { readonly kind: 'token' };

export interface Presented {
  readonly security: ReadonlyMap<string, Redacted.Redacted>;
  readonly auth: boolean;
  readonly headers: ReadonlySet<string>;
}

export type Requirement =
  | { readonly kind: 'met'; readonly placements: readonly Placement[] }
  | { readonly kind: 'unmet'; readonly because: string; readonly headers: readonly string[] };

export interface SecuredEntry {
  readonly security: ReadonlyMap<string, Redacted.Redacted>;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query_params: ReadonlyMap<string, Redacted.Redacted>;
  readonly auth: unknown;
}

export interface EntryProblem {
  readonly path: readonly string[];
  readonly detail: string;
}

type Schemes = Readonly<Record<string, SecurityScheme>>;

function schemesOf(document: ApiDocument): Schemes {
  return document.components?.securitySchemes ?? {};
}

function placingOf(scheme: SecurityScheme): Placing | undefined {
  if (scheme.type === 'apiKey') {
    return scheme.in === 'cookie' ? undefined : { kind: scheme.in, name: scheme.name };
  }
  if (scheme.type === 'http') {
    const written = scheme.scheme.toLowerCase();
    return written === 'bearer' || written === 'basic' ? { kind: written } : undefined;
  }
  return scheme.type === 'mutualTLS' ? undefined : { kind: 'token' };
}

function schemeNamed(schemes: Schemes, name: string): SecurityScheme | undefined {
  return Object.hasOwn(schemes, name) ? schemes[name] : undefined;
}

function presentedPlacement(name: string, schemes: Schemes, presented: Presented): Placement | undefined {
  const scheme = schemeNamed(schemes, name);
  const placing = scheme === undefined ? undefined : placingOf(scheme);
  if (placing === undefined || placing.kind === 'token') {
    return placing !== undefined && presented.auth ? placing : undefined;
  }
  const value = presented.security.get(name);
  return value === undefined ? undefined : { ...placing, value };
}

function placementsOf(
  alternative: SecurityRequirement,
  schemes: Schemes,
  presented: Presented,
): readonly Placement[] | undefined {
  const placements: Placement[] = [];
  for (const name of Object.keys(alternative)) {
    const placement = presentedPlacement(name, schemes, presented);
    if (placement === undefined) {
      return undefined;
    }
    placements.push(placement);
  }
  const laterTokens = new Set(placements.filter(({ kind }) => kind === 'token').slice(1));
  return placements.filter((placement) => !laterTokens.has(placement));
}

function alternativesInWords(alternatives: readonly SecurityRequirement[]): string {
  return alternatives.map((alternative) => Object.keys(alternative).join(' with ')).join(', or ');
}

function headersNamedBy(alternatives: readonly SecurityRequirement[], schemes: Schemes): readonly string[] {
  return alternatives.flatMap((alternative) =>
    Object.keys(alternative).flatMap((name) => {
      const scheme = schemeNamed(schemes, name);
      return scheme?.type === 'apiKey' && scheme.in === 'header' ? [scheme.name] : [];
    }),
  );
}

export function headersPlacedBy(requirement: Requirement): readonly string[] {
  return requirement.kind === 'met'
    ? requirement.placements.flatMap((placement) => (placement.kind === 'header' ? [placement.name] : []))
    : requirement.headers;
}

function placesEvery(placements: readonly Placement[], headers: readonly string[]): boolean {
  return headers.every((header) =>
    placements.some((placement) => placement.kind === 'header' && placement.name.toLowerCase() === header),
  );
}

function placeableOf(
  neededHeaders: ReadonlySet<string>,
  alternatives: readonly SecurityRequirement[],
  schemes: Schemes,
): readonly string[] {
  const named = new Set(headersNamedBy(alternatives, schemes).map((header) => header.toLowerCase()));
  return [...neededHeaders].filter((header) => named.has(header));
}

export function requirementOf(
  document: ApiDocument,
  operation: Operation,
  presented: Presented,
  neededHeaders: ReadonlySet<string>,
): Requirement {
  const alternatives = operation.security ?? document.security ?? [];
  const schemes = schemesOf(document);
  if (alternatives.length === 0) {
    return { kind: 'met', placements: [] };
  }
  const met = alternatives.flatMap((alternative) => {
    const placements = placementsOf(alternative, schemes, presented);
    return placements === undefined ? [] : [placements];
  });
  const [first] = met;
  if (first !== undefined) {
    const placeable = placeableOf(neededHeaders, alternatives, schemes);
    return { kind: 'met', placements: met.find((placements) => placesEvery(placements, placeable)) ?? first };
  }
  return {
    kind: 'unmet',
    because: `it needs the security scheme ${alternativesInWords(alternatives)} of the document, which the security and the auth of the entry do not give`,
    headers: headersNamedBy(alternatives, schemes),
  };
}

function declaredIn(schemes: Schemes): string {
  const names = Object.keys(schemes);
  return names.length === 0 ? 'it declares none' : `it declares ${names.join(', ')}`;
}

function unsentBecause(scheme: SecurityScheme): string | undefined {
  if (scheme.type === 'apiKey') {
    return scheme.in === 'cookie' ? 'An apiKey the document places in a cookie, which a call does not send' : undefined;
  }
  if (scheme.type === 'http') {
    return placingOf(scheme) === undefined
      ? `An http scheme of ${scheme.scheme}, which a call does not send; a call sends bearer and basic`
      : undefined;
  }
  return scheme.type === 'mutualTLS'
    ? 'A mutualTLS scheme, whose certificate a call does not present'
    : `An ${scheme.type} scheme, which the auth block of the entry satisfies with the token it mints; its credential is the client, not a value of security`;
}

function namedProblem(name: string, value: Redacted.Redacted, schemes: Schemes): string | undefined {
  const scheme = schemeNamed(schemes, name);
  if (scheme === undefined) {
    return `The document declares no security scheme of this name; ${declaredIn(schemes)}`;
  }
  const isBasic = scheme.type === 'http' && scheme.scheme.toLowerCase() === 'basic';
  return isBasic && !Redacted.value(value).includes(':')
    ? 'Expected user:password, which a basic scheme sends'
    : unsentBecause(scheme);
}

function placedName(placing: Placing | undefined, kind: 'header' | 'query'): string | undefined {
  if (placing === undefined || placing.kind === 'token') {
    return undefined;
  }
  if (placing.kind === 'bearer' || placing.kind === 'basic') {
    return kind === 'header' ? 'authorization' : undefined;
  }
  return placing.kind === kind ? placing.name.toLowerCase() : undefined;
}

function placedNames(entry: SecuredEntry, schemes: Schemes, kind: 'header' | 'query'): ReadonlyMap<string, string> {
  const placed = new Map<string, string>();
  for (const name of entry.security.keys()) {
    const scheme = schemeNamed(schemes, name);
    const written = placedName(scheme === undefined ? undefined : placingOf(scheme), kind);
    if (written !== undefined) {
      placed.set(written, name);
    }
  }
  return placed;
}

function collisionsOf(
  written: ReadonlyMap<string, Redacted.Redacted>,
  placed: ReadonlyMap<string, string>,
  field: 'headers' | 'query_params',
): readonly EntryProblem[] {
  return [...written.keys()].flatMap((name) => {
    const scheme = placed.get(name.toLowerCase());
    return scheme === undefined
      ? []
      : [
          {
            path: [field, name],
            detail: `Placed by the security scheme ${scheme}; give the credential under security alone`,
          },
        ];
  });
}

function authProblems(entry: SecuredEntry, schemes: Schemes): readonly EntryProblem[] {
  const minted = Object.values(schemes).some(({ type }) => type === 'oauth2' || type === 'openIdConnect');
  return entry.auth === null || minted
    ? []
    : [
        {
          path: ['auth'],
          detail:
            'The document declares no oauth2 or openIdConnect scheme, so no call would send the token this block mints',
        },
      ];
}

export function securityProblemsOf(entry: SecuredEntry, document: ApiDocument): readonly EntryProblem[] {
  const schemes = schemesOf(document);
  const named = [...entry.security].flatMap(([name, value]: readonly [string, Redacted.Redacted]) => {
    const detail = namedProblem(name, value, schemes);
    return detail === undefined ? [] : [{ path: ['security', name], detail }];
  });
  return [
    ...named,
    ...collisionsOf(entry.headers, placedNames(entry, schemes, 'header'), 'headers'),
    ...collisionsOf(entry.query_params, placedNames(entry, schemes, 'query'), 'query_params'),
    ...authProblems(entry, schemes),
  ];
}
