import { createHash } from 'node:crypto';

import type { Issue } from '@on.auto/operations';

export const PORTABLE_FORMAT = 1;
export const PORTABLE_MAX_DEFINITIONS = 100;
export const PORTABLE_MAX_BYTES = 1_048_576;

export interface PortableDefinition {
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
  readonly paused: boolean;
}

export interface PortablePackage {
  readonly format: number;
  readonly page?: string;
  readonly goals?: string;
  readonly definitions: readonly PortableDefinition[];
}

export interface CreatedDefinition {
  readonly type: string;
  readonly name: string;
  readonly created_at: string;
}

type Entry = readonly [string, unknown];

function byCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function firstNonZero(...orders: readonly number[]): number {
  return orders.find((order) => order !== 0) ?? 0;
}

function canonicalOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((inner: unknown) => canonicalOf(inner)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, inner]: Entry) => inner !== undefined)
      .toSorted(([left]: Entry, [right]: Entry) => byCodeUnits(left, right));
    return `{${entries.map(([key, inner]: Entry) => `${JSON.stringify(key)}:${canonicalOf(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  return canonicalOf(value);
}

export function portableDefinitionOf({
  type,
  name,
  source,
  overview,
  diagram,
  paused,
}: PortableDefinition): PortableDefinition {
  return {
    type,
    name,
    source,
    ...(overview === undefined ? {} : { overview }),
    ...(diagram === undefined ? {} : { diagram }),
    paused,
  };
}

export function portablePackageOf({ format, page, goals, definitions }: PortablePackage): PortablePackage {
  return {
    format,
    ...(page === undefined ? {} : { page }),
    ...(goals === undefined ? {} : { goals }),
    definitions: definitions.map((definition) => portableDefinitionOf(definition)),
  };
}

export function packageDigest(written: PortablePackage): string {
  return createHash('sha256')
    .update(canonicalJson(portablePackageOf(written)))
    .digest('hex');
}

export function packageBytes(written: PortablePackage): number {
  return new TextEncoder().encode(canonicalJson(portablePackageOf(written))).length;
}

export function packageCapIssues(written: PortablePackage): readonly Issue[] {
  const count = written.definitions.length;
  const bytes = packageBytes(written);
  return [
    ...(count > PORTABLE_MAX_DEFINITIONS
      ? [
          {
            pointer: '/definitions',
            detail: `A package holds at most ${PORTABLE_MAX_DEFINITIONS} definitions, and this one holds ${count}`,
          },
        ]
      : []),
    ...(bytes > PORTABLE_MAX_BYTES
      ? [{ pointer: '', detail: `A package is at most ${PORTABLE_MAX_BYTES} bytes, and this one is ${bytes}` }]
      : []),
  ];
}

export function inCreationOrder<Created extends CreatedDefinition>(definitions: readonly Created[]): Created[] {
  const byCreation = definitions.toSorted((left: Readonly<Created>, right: Readonly<Created>) =>
    firstNonZero(
      byCodeUnits(left.created_at, right.created_at),
      byCodeUnits(left.type, right.type),
      byCodeUnits(left.name, right.name),
    ),
  );
  return [
    ...byCreation.filter(({ type }) => type !== 'workflow'),
    ...byCreation.filter(({ type }) => type === 'workflow'),
  ];
}
