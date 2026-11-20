import { Effect, Option } from 'effect';

import type { OrgAddress } from '../caller/org-context.ts';
import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type {
  BoundProjectionReader,
  OrgProjectionReader,
  ProjectedAddress,
  ProjectionReader,
} from '../projections/keyed-projection.ts';
import { isCalendarDay } from '../reading/calendar-days.ts';
import { mostExaminedInAPage } from '../reading/page-bounds.ts';
import type { AppendedFact, AppendedFacts, AppendedFactsRequest, AppendedScope } from '../reading/recorded-read.ts';
import type { RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import { namedAsHeldNow, type NamesHeldNow } from './names-held-now.ts';
import type {
  AppendedFactsReader,
  OrgAppendedFactsReader,
  PlaybookAppendedFactsReader,
  PlaybookRunOutcomesReader,
  RunOutcomesReader,
  StreamAges,
  StreamReader,
  StreamWriter,
} from './stream-ports.ts';

const streamNameGrammar = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})*$/u;

const longestStreamName = 256;

export function runStreamNameOf(id: string): string {
  return `runs/${id}`;
}

export function wellFormed(stream: string): Effect.Effect<string> {
  return stream.length <= longestStreamName && streamNameGrammar.test(stream)
    ? Effect.succeed(stream)
    : Effect.die(new Error(`The stream name ${JSON.stringify(stream)} is malformed`));
}

const orgStreams = 'org/';

export function streamPrefixOfOrg({ org }: OrgAddress): string {
  return `${orgStreams}${org}/`;
}

const playbookStreams = 'playbook/';

export function streamPrefixOfPlaybook({ org, playbook }: PlaybookAddress): string {
  return `${playbookStreams}${org}/${playbook}/`;
}

const aPlaybookPrefix = new RegExp(`^${playbookStreams}([^/]+)/([^/]+)/$`, 'u');

export interface DefinitionAddress extends OrgAddress {
  readonly definition: string;
}

const definitionStreams = 'definition/';

export function streamPrefixOfDefinition({ org, definition }: DefinitionAddress): string {
  return `${definitionStreams}${org}/${definition}/`;
}

export function streamPrefixOfTheDefinitionsOf({ org }: OrgAddress): string {
  return `${definitionStreams}${org}/`;
}

const aDefinitionPrefix = new RegExp(`^${definitionStreams}([^/]+)/([^/]+)/$`, 'u');

export function definitionOfStreamPrefix(prefix: string): Option.Option<DefinitionAddress> {
  const [, org, definition] = aDefinitionPrefix.exec(prefix) ?? [];
  return org === undefined || definition === undefined ? Option.none() : Option.some({ org, definition });
}

export function playbookOfStreamPrefix(prefix: string): Option.Option<PlaybookAddress> {
  const [, org, playbook] = aPlaybookPrefix.exec(prefix) ?? [];
  return org === undefined || playbook === undefined ? Option.none() : Option.some({ org, playbook });
}

const anOrgPrefix = new RegExp(`^${orgStreams}([^/]+)/$`, 'u');

export function orgOfStreamPrefix(prefix: string): Option.Option<OrgAddress> {
  const [, org] = anOrgPrefix.exec(prefix) ?? [];
  return org === undefined ? Option.none() : Option.some({ org });
}

export function prefixedReader(ledger: StreamReader, prefix: string): StreamReader {
  return {
    load: (stream, fold) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.load(`${prefix}${relative}`, fold))),
    factAt: (stream, position, eventSchema) =>
      wellFormed(stream).pipe(
        Effect.flatMap((relative) => ledger.factAt(`${prefix}${relative}`, position, eventSchema)),
      ),
  };
}

export function playbookBoundStreamReader(ledger: StreamReader, playbook: PlaybookAddress): StreamReader {
  return prefixedReader(ledger, streamPrefixOfPlaybook(playbook));
}

export function definitionBoundStreamReader(ledger: StreamReader, definition: DefinitionAddress): StreamReader {
  return prefixedReader(ledger, streamPrefixOfDefinition(definition));
}

export function prefixedAges(ledger: StreamAges, prefix: string): StreamAges {
  return {
    ageOfLastAppend: (stream) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.ageOfLastAppend(`${prefix}${relative}`))),
  };
}

export function prefixedWriter(ledger: StreamWriter, prefix: string): StreamWriter {
  return {
    execute: (stream, decider, command, lineage) =>
      wellFormed(stream).pipe(
        Effect.flatMap((relative) => ledger.execute(`${prefix}${relative}`, decider, command, lineage)),
      ),
  };
}

const aDefinitionKey = /^definition\/[^/]+\/[^/]+\//u;

export function streamRelativeTo(prefix: string, stream: string): string {
  return stream.startsWith(prefix) ? stream.slice(prefix.length) : stream.replace(aDefinitionKey, '');
}

function wellFormedWindow(window: RunOutcomeWindow): Effect.Effect<RunOutcomeWindow> {
  const { from, to } = window;
  return isCalendarDay(from) && isCalendarDay(to) && from <= to
    ? Effect.succeed(window)
    : Effect.die(new RangeError(`The days from ${JSON.stringify(from)} to ${JSON.stringify(to)} are not a window`));
}

function boundProjectionReader(ledger: ProjectionReader, address: ProjectedAddress): BoundProjectionReader {
  return {
    readProjectedRows: (projection, query) =>
      Number.isSafeInteger(query.limit) && query.limit >= 1
        ? ledger.readProjectedRows(projection, address, query)
        : Effect.die(new RangeError(`A read of projected rows takes a limit of 1 or more, not ${query.limit}`)),
    countProjectedRows: (projection, where) => ledger.countProjectedRows(projection, address, where),
  };
}

export function definitionBoundProjectionReader(
  ledger: ProjectionReader,
  { org, definition }: DefinitionAddress,
): BoundProjectionReader {
  return boundProjectionReader(ledger, { org, definition });
}

export function playbookBoundProjectionReader(
  ledger: ProjectionReader,
  { org, playbook }: PlaybookAddress,
): BoundProjectionReader {
  return boundProjectionReader(ledger, { org, playbook });
}

export function orgBoundProjectionReader(ledger: ProjectionReader, { org }: OrgAddress): OrgProjectionReader {
  const ofPlaybook = (playbook: string) => boundProjectionReader(ledger, { org, playbook });
  return {
    ...boundProjectionReader(ledger, { org }),
    readPlaybookRows: (playbook, projection, query) => ofPlaybook(playbook).readProjectedRows(projection, query),
    countPlaybookRows: (playbook, projection, where) => ofPlaybook(playbook).countProjectedRows(projection, where),
  };
}

export function playbookBoundRunOutcomesReader(
  ledger: RunOutcomesReader,
  playbook: PlaybookAddress,
): PlaybookRunOutcomesReader {
  return {
    readRunOutcomes: (window, selection) =>
      wellFormedWindow(window).pipe(Effect.flatMap((checked) => ledger.readRunOutcomes(playbook, checked, selection))),
  };
}

function wellFormedRequest(request: AppendedFactsRequest): Effect.Effect<AppendedFactsRequest> {
  const { most } = request;
  return Number.isInteger(most) && most >= 1 && most <= mostExaminedInAPage
    ? Effect.succeed(request)
    : Effect.die(new RangeError(`A read of appended facts takes 1 to ${mostExaminedInAPage} facts, not ${most}`));
}

function factsRelativeTo(prefix: string): (read: AppendedFacts) => AppendedFacts {
  return ({ facts, ...reached }) => ({
    facts: facts.map((fact) => ({ ...fact, stream: streamRelativeTo(prefix, fact.stream) })),
    ...reached,
  });
}

type NamedNow = (facts: readonly AppendedFact[]) => Effect.Effect<readonly AppendedFact[]>;

function boundTo(
  ledger: AppendedFactsReader,
  prefix: string,
  named: NamedNow = Effect.succeed,
): (scope: AppendedScope, request: AppendedFactsRequest) => ReturnType<AppendedFactsReader['readAppendedFacts']> {
  return (scope, request) =>
    wellFormedRequest(request).pipe(
      Effect.flatMap((checked) => ledger.readAppendedFacts(scope, checked)),
      Effect.flatMap(({ facts, ...reached }) => Effect.map(named(facts), (each) => ({ facts: each, ...reached }))),
      Effect.map(factsRelativeTo(prefix)),
    );
}

export function playbookBoundAppendedFactsReader(
  ledger: AppendedFactsReader & NamesHeldNow,
  playbook: PlaybookAddress,
): PlaybookAppendedFactsReader {
  const scope: AppendedScope = { kind: 'playbook', playbook };
  const read = boundTo(ledger, streamPrefixOfPlaybook(playbook), namedAsHeldNow(ledger));
  return {
    readAppendedFacts: (request) => read(scope, request),
    waitForAppend: (after, deadline) => ledger.waitForAppend(scope, after, deadline),
  };
}

export function orgBoundAppendedFactsReader(ledger: AppendedFactsReader, org: OrgAddress): OrgAppendedFactsReader {
  const prefix = streamPrefixOfOrg(org);
  const read = boundTo(ledger, prefix);
  const scopeOf = (streams: readonly string[]): Effect.Effect<AppendedScope> =>
    Effect.map(Effect.forEach(streams, wellFormed), (named: readonly string[]) => ({
      kind: 'streams',
      streams: named.flatMap((stream) => [`${prefix}${stream}`, `${prefix}${stream}/`]),
    }));
  return {
    readAppendedFacts: (streams, request) => Effect.flatMap(scopeOf(streams), (scope) => read(scope, request)),
    waitForAppend: (streams, after, deadline) =>
      Effect.flatMap(scopeOf(streams), (scope) => ledger.waitForAppend(scope, after, deadline)),
  };
}
