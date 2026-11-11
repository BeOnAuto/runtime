import { Option, type Effect } from 'effect';

import type { OrgAddress } from '../caller/org-context.ts';
import {
  orgOfStreamPrefix,
  playbookOfStreamPrefix,
  streamPrefixOfOrg,
  streamPrefixOfPlaybook,
} from '../ledger/bound-ports.ts';
import type { Context } from '../ledger/context.ts';
import type { ProjectedCondition } from './projected-conditions.ts';

export type ProjectedValue = string | number | boolean | null;

export type ProjectedRow = Readonly<Record<string, ProjectedValue>>;

export type ProjectedColumnKind = 'text' | 'integer' | 'boolean';

export interface ProjectedColumn {
  readonly name: string;
  readonly kind: ProjectedColumnKind;
}

export interface ProjectedIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly acrossPlaybooks?: boolean;
  readonly whereSet?: string;
}

export interface ProjectedMessage {
  readonly id: string;
  readonly position: number;
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
}

export interface ProjectedStream {
  readonly kind: string;
  readonly id: string;
}

export interface AdvancedColumn {
  readonly column: string;
  readonly setBy: readonly string[];
}

export type StreamScope = 'playbook' | 'org';

export interface ProjectionDeclaration {
  readonly name: string;
  readonly version: number;
  readonly scopes?: readonly StreamScope[];
  readonly kinds: readonly string[];
  readonly types: readonly string[];
  readonly columns: readonly ProjectedColumn[];
  readonly indexes: readonly ProjectedIndex[];
  readonly keyOf?: (message: ProjectedMessage, stream: ProjectedStream) => string | undefined;
  readonly advanced?: readonly AdvancedColumn[];
}

export interface KeyedProjection extends ProjectionDeclaration {
  readonly rowAfter: (row: ProjectedRow | undefined, message: ProjectedMessage) => ProjectedRow | undefined;
}

export type ProjectedRows = ReadonlyMap<string, ProjectedRow>;

export interface ChildRowsProjection extends ProjectionDeclaration {
  readonly rowsAfter: (rows: ProjectedRows, message: ProjectedMessage) => ProjectedRows | undefined;
}

export type KeptProjection = KeyedProjection | ChildRowsProjection;

export function keepsChildRows(projection: KeptProjection): projection is ChildRowsProjection {
  return 'rowsAfter' in projection;
}

export type ProjectedOrder = 'asc' | 'desc';

export interface ProjectedRowsQuery {
  readonly where: readonly ProjectedCondition[];
  readonly orderBy: readonly string[];
  readonly order: ProjectedOrder;
  readonly after?: readonly ProjectedValue[];
  readonly limit: number;
}

export interface ProjectedAddress extends OrgAddress {
  readonly playbook?: string;
}

export interface ProjectedKeyedRow extends ProjectedAddress {
  readonly key: string;
  readonly child?: string;
  readonly row: ProjectedRow;
}

export interface DueRowsQuery {
  readonly column: string;
  readonly through: number;
  readonly limit: number;
}

export interface ProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    address: ProjectedAddress,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly countProjectedRows: (
    projection: string,
    address: ProjectedAddress,
    where: readonly ProjectedCondition[],
  ) => Effect.Effect<number>;
  readonly readDueRows: (projection: string, query: DueRowsQuery) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly nextDueOf: (projection: string, column: string, after: number) => Effect.Effect<number | null>;
  readonly resetStreamProjection: (projection: string, address: ProjectedAddress) => Effect.Effect<void>;
}

export interface RowAdvance {
  readonly set: ProjectedRow;
  readonly when: readonly ProjectedCondition[];
}

export interface ProjectionAdvancer {
  readonly advanceRow: (
    projection: string,
    address: ProjectedAddress,
    key: string,
    advance: RowAdvance,
  ) => Effect.Effect<void>;
}

export interface BoundProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly countProjectedRows: (projection: string, where: readonly ProjectedCondition[]) => Effect.Effect<number>;
  readonly resetStreamProjection: (projection: string) => Effect.Effect<void>;
}

export interface OrgProjectionReader extends BoundProjectionReader {
  readonly readPlaybookRows: (
    playbook: string,
    projection: string,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly countPlaybookRows: (
    playbook: string,
    projection: string,
    where: readonly ProjectedCondition[],
  ) => Effect.Effect<number>;
}

export const rowKeyColumn = 'row_key';

export const childKeyColumn = 'child_key';

export function streamPrefixOfAddress({ org, playbook }: ProjectedAddress): string {
  return playbook === undefined ? streamPrefixOfOrg({ org }) : streamPrefixOfPlaybook({ org, playbook });
}

export function addressOfStreamPrefix(prefix: string): Option.Option<ProjectedAddress> {
  return Option.orElse(playbookOfStreamPrefix(prefix), () => orgOfStreamPrefix(prefix));
}

export interface AddressedStream extends ProjectedStream {
  readonly scope: StreamScope;
  readonly prefix: string;
  readonly address: ProjectedAddress;
}

const aPlaybookKindAndId = /^([^/]+\/[^/]+\/[^/]+\/)([^/]+)\/([^/]+)$/u;

const anOrgKindAndId = /^([^/]+\/[^/]+\/)([^/]+)\/([^/]+)$/u;

function streamIn(
  scope: StreamScope,
  pattern: Readonly<RegExp>,
  addressOf: (prefix: string) => Option.Option<ProjectedAddress>,
  stream: string,
): Option.Option<AddressedStream> {
  const [, prefix = '', kind = '', id = ''] = pattern.exec(stream) ?? [];
  return Option.map(addressOf(prefix), (address) => ({ scope, prefix, address, kind, id }));
}

export function addressedStreamOf(stream: string): AddressedStream | undefined {
  return Option.getOrUndefined(
    Option.orElse(streamIn('playbook', aPlaybookKindAndId, playbookOfStreamPrefix, stream), () =>
      streamIn('org', anOrgKindAndId, orgOfStreamPrefix, stream),
    ),
  );
}

const playbookStreamsAlone: readonly StreamScope[] = ['playbook'];

export function scopesOf({ scopes = playbookStreamsAlone }: ProjectionDeclaration): readonly StreamScope[] {
  return scopes;
}

export function foldsStream(projection: ProjectionDeclaration, { scope, kind }: AddressedStream): boolean {
  return scopesOf(projection).includes(scope) && projection.kinds.includes(kind);
}

export function rowKeyOf(
  projection: ProjectionDeclaration,
  message: ProjectedMessage,
  stream: AddressedStream,
): string | undefined {
  if (!foldsStream(projection, stream)) {
    return undefined;
  }
  return projection.keyOf === undefined ? stream.id : projection.keyOf(message, stream);
}

export function advancedColumnsOf({ advanced = [] }: ProjectionDeclaration): readonly string[] {
  return advanced.map(({ column }) => column);
}

export function advancedColumnsLeftBy({ advanced = [] }: ProjectionDeclaration, type: string): readonly string[] {
  return advanced.filter(({ setBy }) => !setBy.includes(type)).map(({ column }) => column);
}

export function requireAdvancedColumns(projection: ProjectionDeclaration, columns: ProjectedRow): void {
  const advanced = new Set(advancedColumnsOf(projection));
  const other = Object.keys(columns).find((column) => !advanced.has(column));
  if (other !== undefined) {
    throw new Error(`The projection ${projection.name} does not let its reader advance the column ${other}`);
  }
}

export function projectedTableOf({ name, version }: Pick<ProjectionDeclaration, 'name' | 'version'>): string {
  return `${name}_${version}`;
}
