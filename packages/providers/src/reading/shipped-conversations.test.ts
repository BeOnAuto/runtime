import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import {
  conversationsOf,
  joinedProviders,
  providersShippedRoots,
  readProviders,
  type Conversations,
  type Provider,
} from '../index.ts';
import { tracker } from '../testing/index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const OperationSchema = Schema.optionalKey(Schema.Struct({ operationId: Schema.String }));

const PathItemSchema = Schema.Struct({
  get: OperationSchema,
  head: OperationSchema,
  post: OperationSchema,
  put: OperationSchema,
  patch: OperationSchema,
  delete: OperationSchema,
});

type PathItem = typeof PathItemSchema.Type;

const decodePaths = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ paths: Schema.Record(Schema.String, PathItemSchema) })),
);

type Mark = 'reads' | 'acts';

type Marked = readonly [string, Mark];

function markedByMethod({ get, head, post, put, patch, delete: deleting }: PathItem): readonly Marked[] {
  const reading = [get, head].flatMap((operation) => (operation === undefined ? [] : [operation.operationId]));
  const acting = [post, put, patch, deleting].flatMap((operation) =>
    operation === undefined ? [] : [operation.operationId],
  );
  return [...reading.map((tool): Marked => [tool, 'reads']), ...acting.map((tool): Marked => [tool, 'acts'])];
}

function marksOfTheDocument({ entry }: Pick<Provider, 'entry'>): ReadonlyMap<string, Mark> {
  const { paths } = decodePaths(shipped.documents.get(entry.document ?? '')?.text ?? '{"paths":{}}');
  const markedReads = (entry.marks?.reads ?? []).map((tool): Marked => [tool, 'reads']);
  return new Map([...Object.values(paths).flatMap((item) => markedByMethod(item)), ...markedReads]);
}

function toolsOf({ reply, react }: Conversations): readonly string[] {
  return [reply.tool, ...(react === undefined ? [] : [react.tool])];
}

function shippedPart(name: string): Conversations {
  return Option.getOrThrow(Option.fromNullishOr(conversationsOf(shipped, name)));
}

const declaring = shipped.providers.filter(({ entry }) => entry.conversations !== undefined);

describe('the conversations parts of the shipped providers', () => {
  it('are written for the chats Auto can reply in, Slack as the person or as a bot and Teams, each telling all', () => {
    expect(declaring.map(({ entry }) => [entry.name, entry.conversations?.tell])).toEqual([
      ['microsoft-teams', 'all'],
      ['slack', 'all'],
      ['slack-bot', 'all'],
    ]);
  });

  it('name only operations of the document beside the entry, each one that acts', () => {
    const named = declaring.flatMap((provider) => {
      const marks = marksOfTheDocument(provider);
      return toolsOf(shippedPart(provider.entry.name)).map((tool) => [tool, marks.get(tool)]);
    });

    expect(named).toEqual([
      ['chats.CreateMessages', 'acts'],
      ['chat_postMessage', 'acts'],
      ['reactions_add', 'acts'],
      ['chat_postMessage', 'acts'],
      ['reactions_add', 'acts'],
    ]);
  });

  it('take a mark the entry gives over the method of the operation', () => {
    const slack = Option.getOrThrow(Option.fromNullishOr(declaring.find(({ entry }) => entry.name === 'slack')));

    expect(
      marksOfTheDocument({ entry: { ...slack.entry, marks: { reads: ['chat_postMessage'] } } }).get('chat_postMessage'),
    ).toBe('reads');
  });

  it('are answered for a provider by its name, and for a server added by hand or a provider that declares none, not at all', () => {
    expect(conversationsOf(shipped, 'slack')).toMatchObject({
      tell: 'all',
      reply: { tool: 'chat_postMessage', sent: '/ts' },
      react: { tool: 'reactions_add' },
    });
    expect([null, 'zoom', 'unknown'].map((provider: string | null) => conversationsOf(shipped, provider))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('the read limits of the shipped providers', () => {
  it('limit the reads of Slack as the person, through the clients Auto lends, to one a minute, as Slack limits an app outside its Marketplace', () => {
    expect(declaring.map(({ entry }) => [entry.name, entry.conversations?.read_limit])).toEqual([
      ['microsoft-teams', undefined],
      ['slack', { quota: 1, window_seconds: 60, clients: ['auto'] }],
      ['slack-bot', undefined],
    ]);
  });

  it('are answered with the part for a connection signed in through a client they name, and left out for any other', () => {
    expect([
      conversationsOf(shipped, 'slack', 'auto')?.read_limit,
      conversationsOf(shipped, 'slack', 'registered')?.read_limit,
      conversationsOf(shipped, 'slack')?.read_limit,
      conversationsOf(shipped, 'slack', 'registered')?.reply.tool,
    ]).toEqual([{ quota: 1, window_seconds: 60, clients: ['auto'] }, undefined, undefined, 'chat_postMessage']);
  });

  it('are answered for every client where they name none', () => {
    const chat = Schema.decodeUnknownSync(ProviderEntrySchema)({
      ...tracker,
      name: 'team-chat',
      conversations: {
        tell: 'all',
        reply: { tool: 'post_message', with: { text: '{{ message }}' }, sent: '/ts' },
        read_limit: { quota: 2, window_seconds: 10 },
      },
    });
    const limited = joinedProviders(shipped, [chat]);

    expect([
      conversationsOf(limited, 'team-chat')?.read_limit,
      conversationsOf(limited, 'team-chat', 'own')?.read_limit,
    ]).toEqual([
      { quota: 2, window_seconds: 10 },
      { quota: 2, window_seconds: 10 },
    ]);
  });
});
