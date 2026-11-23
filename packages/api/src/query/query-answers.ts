import { staleReadsOf, type Catalog, type Outcome, type RouteRegistration, type StaleRead } from '@on.auto/operations';
import DataLoader from 'dataloader';
import { Predicate } from 'effect';
import { GraphQLError, execute, locatedError, parse, specifiedRules, validate, type DocumentNode } from 'graphql';

import { limitsBrokenBy, QUERY_LIMITS, type QueryLimits } from './query-limits.ts';
import {
  isQueryRead,
  querySchemaOf,
  QueryReads,
  type ReadEdge,
  type QuerySchema,
  type ReadAsked,
} from './query-schema.ts';
import { READ_EDGES } from './read-edges.ts';

export interface QueryServing {
  readonly schema: QuerySchema;
  readonly limits: QueryLimits;
  readonly position: RouteRegistration | undefined;
  readonly positionInput: Readonly<Record<string, unknown>>;
}

export interface QueryAsked {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>> | null | undefined;
  readonly operationName?: string | null | undefined;
}

export interface QueryAnswered {
  readonly status: 200 | 400;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface QueryServed {
  readonly edges?: readonly ReadEdge[] | undefined;
  readonly limits?: QueryLimits | undefined;
}

export type ReadsAnswered = (reads: readonly ReadAsked[]) => Promise<readonly Outcome[]>;

const POSITION_READ = 'list_org_changes';

const ACROSS_THE_PLAYBOOKS = { scope: 'org_and_playbooks' };

function takesAScope(registration: RouteRegistration | undefined): boolean {
  const properties: unknown = registration?.input.schema['properties'];
  return Predicate.hasProperty(properties, 'scope');
}

export function queryServingOf(
  catalog: Catalog,
  edges: readonly ReadEdge[] = READ_EDGES,
  limits: QueryLimits = QUERY_LIMITS,
): QueryServing {
  const position = catalog
    .operationsIn('org')
    .find((registration) => registration.name === POSITION_READ && isQueryRead(registration));
  return {
    schema: querySchemaOf(catalog, edges),
    limits,
    position,
    positionInput: takesAScope(position) ? ACROSS_THE_PLAYBOOKS : {},
  };
}

function valueOf(outcome: Outcome): unknown {
  if (outcome.status === 'succeeded') return outcome.output;
  return outcome.status === 'rejected'
    ? new GraphQLError(outcome.detail, { extensions: { code: outcome.reason } })
    : new GraphQLError('The read failed', { extensions: { code: 'failed', incident: outcome.incident } });
}

function keyOf({ registration, playbook, input }: ReadAsked): string {
  return JSON.stringify([registration.scope, registration.name, playbook ?? null, input]);
}

function refused(serving: QueryServing, errors: readonly GraphQLError[] | undefined): QueryAnswered {
  return { status: 400, body: { errors, extensions: { schema_version: serving.schema.version } } };
}

function documentOf(query: string): DocumentNode | GraphQLError {
  try {
    return parse(query);
  } catch (error: unknown) {
    return locatedError(error, null);
  }
}

function keyOfStale({ kind, playbook, key }: StaleRead): string {
  return JSON.stringify([kind, playbook ?? null, key ?? null]);
}

function readOnce(reads: readonly StaleRead[]): readonly StaleRead[] {
  return [...new Map(reads.map((read) => [keyOfStale(read), read])).values()];
}

function cursorOf(read: unknown): string | null {
  const cursor: unknown = Predicate.hasProperty(read, 'cursor') && read['cursor'];
  return typeof cursor === 'string' ? cursor : null;
}

function cursorTakenFirst(
  { position, positionInput }: QueryServing,
  answered: ReadsAnswered,
): () => Promise<string | null> {
  const taken: { cursor?: Promise<string | null> } = {};
  return () => {
    taken.cursor ??=
      position === undefined
        ? Promise.resolve(null)
        : answered([{ registration: position, input: positionInput }]).then(
            ([outcome]) => (outcome?.status === 'succeeded' ? cursorOf(outcome.output) : null),
            () => null,
          );
    return taken.cursor;
  };
}

export async function queryAnswered(
  serving: QueryServing,
  { query, variables, operationName }: QueryAsked,
  answered: ReadsAnswered,
): Promise<QueryAnswered> {
  const { schema } = serving.schema;
  const document = documentOf(query);
  if (document instanceof GraphQLError) return refused(serving, [document]);
  const invalid = validate(schema, document, specifiedRules);
  if (invalid.length > 0) return refused(serving, invalid);
  const broken = limitsBrokenBy(schema, document, operationName ?? undefined, serving.limits);
  if (broken.length > 0) return refused(serving, broken);
  const read: StaleRead[] = [];
  const cursorFirst = cursorTakenFirst(serving, answered);
  const loader = new DataLoader<ReadAsked, unknown, string>(
    async (reads) => {
      await cursorFirst();
      read.push(
        ...reads.flatMap(({ registration, playbook, input }) =>
          staleReadsOf(registration.staleOn, { playbook, input }),
        ),
      );
      return (await answered(reads)).map((outcome) => valueOf(outcome));
    },
    { cacheKeyFn: keyOf },
  );
  const result = await execute({
    schema,
    document,
    variableValues: variables ?? null,
    operationName: operationName ?? null,
    contextValue: new QueryReads((asked) => loader.load(asked)),
  });
  if (!('data' in result)) return refused(serving, result.errors);
  const cursor = await cursorFirst();
  return {
    status: 200,
    body: {
      ...result,
      extensions: { schema_version: serving.schema.version, cursor, read: readOnce(read) },
    },
  };
}
