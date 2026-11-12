import { Forbidden, Unavailable, type InvalidInput, type Issue } from '@on.auto/operations';
import { fetchWithin, type Reaches } from '@on.auto/outbound';
import { counted } from '@on.auto/phrasing';
import {
  describedToolServers,
  type LeftOutOperation,
  type ServerSettings,
  type ToolServerDocumentRefused,
  type ToolServers,
} from '@on.auto/tool-servers';
import { Effect, JsonPointer, Option } from 'effect';

import type { GivenAddition } from '../providers/provider-additions.ts';
import { connectionDocumentOf, type ConnectionDocument } from '../registry/connection-entry.ts';
import { invalidAddition, settingsOfTheAddition, type EntryChecking } from './entry-checks.ts';
import { fetchingThrough, passingFailureOf, withoutFetchedValues, type Fetching } from './fetched-documents.ts';

export interface DescribedAddition extends GivenAddition {
  readonly document?: ConnectionDocument;
}

interface Describing {
  readonly fetch: typeof globalThis.fetch;
  readonly reaches: Reaches;
}

type Linked = ToolServers['servers'][number];

type DescribedApi = Extract<Linked, { readonly api: unknown }>;

interface Read {
  readonly baseUrl: string;
  readonly toolCount: number;
  readonly leftOut: readonly LeftOutOperation[];
}

type Refused = InvalidInput | Forbidden | Unavailable;

const operationNoun = { one: 'operation', other: 'operations' };

const ofTheAddress = '/entry/document';

function isDescribedByHand({ provider, type }: GivenAddition): boolean {
  return provider === null && type === 'openapi';
}

function isDescribedApi(server: Linked): server is DescribedApi {
  return 'api' in server;
}

function documentPointerOf({ documentText }: GivenAddition): string {
  return documentText === undefined ? ofTheAddress : '/entry/document_text';
}

function issuePointerOf(addition: GivenAddition, written: string): string {
  const field = written.slice(`/${JsonPointer.escapeToken(addition.name)}`.length);
  if (field === '/document') {
    return documentPointerOf(addition);
  }
  if (field.startsWith('/security/')) {
    return '/credential/name';
  }
  return field === '/auth' ? '/credential' : `/entry${field}`;
}

const unresolvedWords = {
  document: (url: string) => `The document at ${url} cannot be read now`,
  base: (url: string) => `The calls of the HTTP API at ${url} cannot be checked now`,
} as const;

function reached(
  reaches: Reaches,
  url: string,
  lead: (url: string) => string,
): Effect.Effect<void, Forbidden | Unavailable> {
  return Effect.tryPromise({
    try: () => Promise.resolve(reaches(url)),
    catch: () =>
      new Unavailable({
        detail: `${lead(url)}: the address of its host could not be looked up; try again in a moment`,
      }),
  }).pipe(
    Effect.flatMap((refusal) =>
      refusal === undefined ? Effect.void : Effect.fail(new Forbidden({ detail: refusal })),
    ),
  );
}

function headerWordsOf(header: string): string {
  return `. Where ${header} takes the same value on every call, give that value in entry.headers; where ${header} carries the key, name it in the credential, as a secret in a header, and the person gives its value on the page; a function never sends it, so no value of it goes in a function's arguments or its prompt`;
}

function leftOutWordsOf({ operation, because, header }: LeftOutOperation): string {
  const words = `The document offers no tool for the operation ${operation}: ${because}`;
  return header === undefined ? words : `${words}${headerWordsOf(header)}`;
}

const whereTheDocumentComesFrom =
  "Give document only where the service's own documentation states that address; otherwise write the OpenAPI document from that documentation, describing the calls the job needs, and give it in document_text, with base_url";

function advisedFor({ documentText }: GivenAddition, issues: readonly Issue[]): readonly Issue[] {
  const atTheAddress = documentText === undefined && issues.some(({ pointer }) => pointer === ofTheAddress);
  return atTheAddress ? [...issues, { pointer: ofTheAddress, detail: whereTheDocumentComesFrom }] : issues;
}

function refusedFor(addition: GivenAddition, details: readonly string[]): InvalidInput {
  const pointer = documentPointerOf(addition);
  return invalidAddition(
    advisedFor(
      addition,
      details.map((detail): Issue => ({ pointer, detail })),
    ),
  );
}

function noToolWordsOf({ documentText }: GivenAddition, leftOut: readonly LeftOutOperation[]): readonly string[] {
  if (leftOut.length === 0) {
    return ['The document offers no tool: it describes no operation'];
  }
  return documentText === undefined
    ? [
        `The document offers no tool the runtime can call: it leaves out each of its ${counted(leftOut.length, operationNoun)}`,
      ]
    : leftOut.map((each) => leftOutWordsOf(each));
}

function toolsRefusalOf(addition: GivenAddition, { toolCount, leftOut }: Read): InvalidInput | undefined {
  if (toolCount === 0) {
    return refusedFor(addition, noToolWordsOf(addition, leftOut));
  }
  return addition.documentText !== undefined && leftOut.length > 0
    ? refusedFor(
        addition,
        leftOut.map((each) => leftOutWordsOf(each)),
      )
    : undefined;
}

function refusalOfTheDocument(
  addition: GivenAddition,
  { answered }: Pick<Fetching, 'answered'>,
): (refused: Pick<ToolServerDocumentRefused, 'problems'>) => InvalidInput | Unavailable {
  return ({ problems }) => {
    const issues = problems.map(({ pointer = '', detail }): Issue => ({
      pointer: issuePointerOf(addition, pointer),
      detail,
    }));
    const { document } = addition.entry;
    if (document === undefined) {
      return invalidAddition(issues);
    }
    return (
      passingFailureOf(document, answered()) ??
      invalidAddition(
        advisedFor(
          addition,
          issues.map((issue) => withoutFetchedValues(issue)),
        ),
      )
    );
  };
}

function apiOf({ servers: [described] }: ToolServers): DescribedApi['api'] {
  return Option.getOrThrow(Option.filter(Option.fromNullishOr(described), isDescribedApi)).api;
}

function readOf(settings: ServerSettings, addition: GivenAddition, { fetch, reaches }: Describing) {
  const leftOut: LeftOutOperation[] = [];
  const reportLeftOut = (_server: string, operation: LeftOutOperation) => {
    leftOut.push(operation);
  };
  const fetching = fetchingThrough(fetch);
  const describing = { fetch: fetchWithin(fetching.fetch, reaches), reportLeftOut };
  return describedToolServers({ servers: [settings], referencedVariables: [] }, describing).pipe(
    Effect.mapError(refusalOfTheDocument(addition, fetching)),
    Effect.map((servers): Read => {
      const { baseUrl, operations } = apiOf(servers);
      return { baseUrl, toolCount: operations.length, leftOut };
    }),
  );
}

function describedOf(addition: GivenAddition, { baseUrl, toolCount }: Read): DescribedAddition {
  const { documentText, entry } = addition;
  return documentText === undefined
    ? { ...addition, entry: { ...entry, base_url: entry.base_url ?? baseUrl } }
    : { ...addition, document: connectionDocumentOf(documentText, toolCount) };
}

export function describedAdditionOf(
  addition: GivenAddition,
  checking: EntryChecking,
  { fetch, reaches }: Describing,
): Effect.Effect<DescribedAddition, Refused> {
  if (!isDescribedByHand(addition)) {
    return Effect.succeed(addition);
  }
  return Effect.gen(function* () {
    const { document } = addition.entry;
    if (document !== undefined) {
      yield* reached(reaches, document, unresolvedWords.document);
    }
    const read = yield* readOf(settingsOfTheAddition(addition, checking), addition, { fetch, reaches });
    yield* reached(reaches, read.baseUrl, unresolvedWords.base);
    const refusal = toolsRefusalOf(addition, read);
    return refusal === undefined ? describedOf(addition, read) : yield* Effect.fail(refusal);
  });
}
