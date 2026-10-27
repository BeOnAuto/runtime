import { Buffer } from 'node:buffer';

import { defineQuery, makeCatalog, makeDispatcher, type Registration } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { guideShelfOf, mcpRoutes, mostArgumentDescriptionCharacters, mostDescriptionCharacters } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';
import { asking, sentencesOf } from '../testing/asking-operation.ts';
import { postMcp, requestOf } from '../testing/mcp-requests.ts';
import { testRetryStateKeys, testServerInfo } from '../testing/operation-server.ts';

const reportedErrors: string[] = [];

const emptyShelf = guideShelfOf([], [], []);

interface Serving {
  readonly operations: readonly { readonly registration: Registration }[];
}

function handlerOf({ operations }: Serving) {
  return createTestHandler({
    routes: [
      mcpRoutes({
        catalog: makeCatalog(operations),
        dispatcher: makeDispatcher([]),
        runCall: () => Promise.reject(new Error('not called')),
        serverInfo: testServerInfo,
        retryStateKeys: testRetryStateKeys,
        shelf: emptyShelf,
        reportError: (error) => {
          reportedErrors.push(error.message);
        },
      }),
    ],
  }).handler;
}

function starting(serving: Serving): () => void {
  return () => {
    handlerOf(serving);
  };
}

const twoSentences = 'Asks. It answers. ';

const longestArgument = 'q'.repeat(mostArgumentDescriptionCharacters);

function describedIn(length: number): string {
  return `${twoSentences}${sentencesOf(length - twoSentences.length)}`;
}

function toolNameOf(verb: string, index: number): string {
  return `${verb}_${'a'.repeat(Math.floor(index / 26))}${String.fromCodePoint(97 + (index % 26))}`;
}

const leastDescription = 20;

const descriptionRoom = mostDescriptionCharacters - leastDescription;

function describedWithin(extra: number, index: number): string {
  return describedIn(leastDescription + Math.min(descriptionRoom, Math.max(0, extra - descriptionRoom * index)));
}

function tellingInTheOrg(name: string, description: string, argument: string) {
  return defineQuery('org', {
    name,
    title: 'Tell',
    description,
    route: { method: 'GET', path: `/${name.replaceAll('_', '-')}` },
    inputSchema: Schema.Struct({ news: Schema.optionalKey(Schema.String.annotate({ description: argument })) }),
    outputSchema: Schema.Struct({ told: Schema.Boolean }),
    reasons: [],
    handle: () => Effect.succeed({ told: true }),
    plainLanguage: { task: 'tell', attempt: () => 'tell', outcome: () => 'Told.' },
  });
}

function orgToolsFilled(count: number, extra: number, argument = 'What to tell') {
  return Array.from({ length: count }, (_, index) =>
    tellingInTheOrg(toolNameOf('tell', index), describedWithin(extra, index), argument),
  );
}

function playbookToolsFilled(count: number, extra: number, argument = 'What to ask') {
  return Array.from({ length: count }, (_, index) =>
    asking({ name: toolNameOf('ask', index), description: describedWithin(extra, index), argument }),
  );
}

interface Listing {
  readonly endpoint: string;
  readonly path: string;
  readonly most: number;
  readonly servingWith: (extra: number) => Serving;
}

const listings: readonly Listing[] = [
  {
    endpoint: 'own org',
    path: '/mcp',
    most: 48_000,
    servingWith: (extra) => ({
      operations: [
        ...orgToolsFilled(6, descriptionRoom * 6, longestArgument),
        ...playbookToolsFilled(25, extra, longestArgument),
      ],
    }),
  },
  {
    endpoint: 'org',
    path: '/orgs/acme/mcp',
    most: 14_400,
    servingWith: (extra) => ({ operations: orgToolsFilled(12, extra, longestArgument) }),
  },
  {
    endpoint: 'playbook',
    path: '/orgs/acme/playbooks/alpha/mcp',
    most: 40_000,
    servingWith: (extra) => ({ operations: playbookToolsFilled(31, extra, longestArgument) }),
  },
];

async function listingBytesOn({ path, servingWith }: Listing, extra: number): Promise<number> {
  const answer = await postMcp(
    handlerOf(servingWith(extra)),
    path,
    { 'mcp-protocol-version': '2025-11-25' },
    requestOf(1, 'tools/list'),
  );
  return Buffer.byteLength(answer.text);
}

describe('the listing of a connection', () => {
  it.each(listings)(
    'starts the server with the $endpoint endpoint listing $most bytes on the wire, and refuses to start it one byte over',
    async (listing) => {
      const extra = listing.most - (await listingBytesOn(listing, 0));

      expect(await listingBytesOn(listing, extra)).toBe(listing.most);
      expect(starting(listing.servingWith(extra + 1))).toThrow(
        `The listing of the ${listing.endpoint} endpoint: ${listing.most + 1} bytes on the wire, more than the ${listing.most} allowed`,
      );
    },
  );
});
