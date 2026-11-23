import { sha256Of } from '@on.auto/content';
import type { Catalog, RouteRegistration } from '@on.auto/operations';
import { Predicate } from 'effect';
import {
  GraphQLError,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  printSchema,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigMap,
} from 'graphql';

import { pascalCaseOf } from './json-schema-reading.ts';
import { typesOfJsonSchema, type FieldsAdded, type TypesOfJsonSchema } from './schema-types.ts';

export type BoundInput = Readonly<Record<string, unknown>>;

export interface BoundRead {
  readonly field: string;
  readonly operation: string;
  readonly description: string;
  readonly binds: readonly string[];
  readonly input: (item: BoundInput, playbook: string) => BoundInput | readonly BoundInput[] | undefined;
  readonly many?: boolean;
}

export interface ReadEdge {
  readonly operation: string;
  readonly scope?: 'org' | 'playbook';
  readonly at: readonly string[];
  readonly key?: string;
  readonly reads?: readonly BoundRead[];
}

export const PLAYBOOKS_LISTED: ReadEdge = { operation: 'list_playbooks', at: ['playbooks'], key: 'id' };

export interface ReadAsked {
  readonly registration: RouteRegistration;
  readonly playbook?: string;
  readonly input: Readonly<Record<string, unknown>>;
}

function keptIn(playbooks: WeakMap<object, string>, answer: unknown, playbook: string): void {
  if (typeof answer !== 'object' || answer === null || playbooks.has(answer)) return;
  playbooks.set(answer, playbook);
  for (const each of Object.values(answer)) keptIn(playbooks, each, playbook);
}

export class QueryReads {
  readonly read: (asked: ReadAsked) => Promise<unknown>;
  readonly playbookOf: (item: object) => string | undefined;

  constructor(read: (asked: ReadAsked) => Promise<unknown>) {
    const playbooks = new WeakMap<object, string>();
    this.read = async (asked) => {
      const answer = await read(asked);
      if (asked.playbook === undefined || typeof answer !== 'object' || answer === null) return answer;
      const own = playbooks.get(answer) ?? asked.playbook;
      const kept = own === asked.playbook ? answer : structuredClone(answer);
      keptIn(playbooks, kept, asked.playbook);
      return kept;
    };
    this.playbookOf = (item) => playbooks.get(item);
  }
}

export interface QuerySchema {
  readonly schema: GraphQLSchema;
  readonly text: string;
  readonly version: string;
}

type ReadField = GraphQLFieldConfig<unknown, unknown, Readonly<Record<string, unknown>>>;

export function isQueryRead(registration: RouteRegistration): boolean {
  return registration.kind === 'query' && registration.route.method === 'GET';
}

function rootNamesOf(catalog: Catalog): (registration: RouteRegistration) => string {
  const inPlaybooks = new Set(catalog.operationsIn('playbook').map(({ name }) => name));
  return ({ scope, name }) => (scope === 'org' && inPlaybooks.has(name) ? `${name}_in_org` : name);
}

function given(args: Readonly<Record<string, unknown>>, apart?: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([name, value]: readonly [string, unknown]) => name !== apart && value !== null),
  );
}

function readsOf(context: unknown): QueryReads {
  if (context instanceof QueryReads) {
    return context;
  }
  throw new GraphQLError('The query was given no reads', { extensions: { code: 'failed' } });
}

function playbookOf(source: unknown, key: string): string {
  const playbook: unknown = Predicate.hasProperty(source, key) && source[key];
  if (typeof playbook !== 'string') {
    throw new GraphQLError(`The item names no playbook by its ${key}`, { extensions: { code: 'bad_request' } });
  }
  return playbook;
}

const playbookArgument = { type: new GraphQLNonNull(GraphQLString), description: 'The playbook to read' };

interface Fields {
  readonly types: TypesOfJsonSchema;
  readonly rootNameOf: (registration: RouteRegistration) => string;
  readonly edges: readonly ReadEdge[];
  readonly playbookReads: readonly RouteRegistration[];
}

function argumentsOf({ types }: Fields, { input }: RouteRegistration, bound: readonly string[] = []) {
  return Object.fromEntries(
    Object.entries(types.argumentsOf(input.schema, input.definitions)).filter(
      ([name]: readonly [string, unknown]) => !bound.includes(name),
    ),
  );
}

function isMany(input: BoundInput | readonly BoundInput[]): input is readonly BoundInput[] {
  return Array.isArray(input);
}

function boundIn(edge: ReadEdge, source: unknown, context: unknown): readonly [string, BoundInput] | undefined {
  if (!Predicate.isObject(source)) return undefined;
  const keyed: unknown =
    edge.key !== undefined && Predicate.hasProperty(source, edge.key) ? source[edge.key] : undefined;
  const playbook = edge.key === undefined ? readsOf(context).playbookOf(source) : keyed;
  return typeof playbook === 'string' ? [playbook, { ...source }] : undefined;
}

function readsOfAPlaybook(fields: Fields, edge: ReadEdge): GraphQLFieldConfigMap<unknown, unknown> {
  return Object.fromEntries(
    fields.playbookReads.map((registration): readonly [string, ReadField] => [
      registration.name,
      {
        type: answerOf(fields, registration),
        description: registration.description,
        args: argumentsOf(fields, registration),
        extensions: { reads: true },
        resolve: (source, args, context) =>
          readsOf(context).read({
            registration,
            playbook: playbookOf(source, String(edge.key)),
            input: given(args),
          }),
      },
    ]),
  );
}

function boundFieldOf(fields: Fields, edge: ReadEdge, bound: BoundRead): readonly [string, ReadField][] {
  const registration = fields.playbookReads.find(({ name }) => name === bound.operation);
  if (registration === undefined) return [];
  const answer = answerOf(fields, registration);
  return [
    [
      bound.field,
      {
        type: bound.many === true ? new GraphQLList(answer) : answer,
        description: bound.description,
        args: argumentsOf(fields, registration, bound.binds),
        extensions: { reads: true },
        resolve: (source, args, context) => {
          const placed = boundIn(edge, source, context);
          if (placed === undefined) return null;
          const [playbook, item] = placed;
          const input = bound.input(item, playbook);
          if (input === undefined) return null;
          const readOf = (each: BoundInput) =>
            readsOf(context).read({ registration, playbook, input: { ...given(args), ...each } });
          return isMany(input) ? input.map((each) => readOf(each)) : readOf(input);
        },
      },
    ],
  ];
}

function addedBy(fields: Fields, edge: ReadEdge): FieldsAdded {
  return {
    id: `${edge.scope ?? 'org'}:${edge.operation}:${edge.at.join('.')}`,
    at: edge.at,
    fields: () =>
      edge.reads === undefined
        ? readsOfAPlaybook(fields, edge)
        : Object.fromEntries(edge.reads.flatMap((bound) => boundFieldOf(fields, edge, bound))),
  };
}

function answerOf(fields: Fields, registration: RouteRegistration) {
  const { output, scope, name } = registration;
  const added = fields.edges
    .filter((edge) => (edge.scope ?? 'org') === scope && edge.operation === name)
    .map((edge) => addedBy(fields, edge));
  return fields.types.outputOf(
    { ...output.schema },
    output.definitions,
    `${pascalCaseOf(fields.rootNameOf(registration))}Answer`,
    added,
  );
}

function rootFieldOf(fields: Fields, registration: RouteRegistration): ReadField {
  const inAPlaybook = registration.scope === 'playbook';
  return {
    type: answerOf(fields, registration),
    description: registration.description,
    args: { ...(inAPlaybook ? { playbook: playbookArgument } : {}), ...argumentsOf(fields, registration) },
    extensions: { reads: true },
    resolve: (_source, args, context) => {
      const input = given(args, inAPlaybook ? 'playbook' : undefined);
      const playbook = args['playbook'];
      return readsOf(context).read(
        inAPlaybook && typeof playbook === 'string' ? { registration, playbook, input } : { registration, input },
      );
    },
  };
}

export function querySchemaOf(catalog: Catalog, edges: readonly ReadEdge[] = [PLAYBOOKS_LISTED]): QuerySchema {
  const reads = catalog.operations.filter((registration) => isQueryRead(registration));
  const fields: Fields = {
    types: typesOfJsonSchema(),
    rootNameOf: rootNamesOf(catalog),
    edges,
    playbookReads: reads.filter(({ scope }) => scope === 'playbook'),
  };
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: Object.fromEntries(
        reads.map((registration) => [fields.rootNameOf(registration), rootFieldOf(fields, registration)]),
      ),
    }),
  });
  const text = printSchema(schema);
  return { schema, text, version: sha256Of(text).slice(0, 16) };
}
