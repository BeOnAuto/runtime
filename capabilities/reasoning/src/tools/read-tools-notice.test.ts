import type { PlaybookAddress } from '@on.auto/operations';
import { serveFakeMcp, type FakeMcpServer, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { reasoningAdapter } from '../testing/reasoning-runs.ts';
import { graphAccessTo, graphKey } from '../testing/resumed-attempts.ts';
import { scriptedLanguageModel } from '../testing/scripted-language-model.ts';
import { readToolsNoticeOf } from './read-tools-notice.ts';

const inAlpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

function aTool(name: string, readOnlyHint: boolean): FakeTool {
  return {
    name,
    description: `The ${name} tool`,
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint },
    answer: () => ({ content: [{ type: 'text', text: name }] }),
  };
}

const reads = ['pull_request_read', 'search_code', 'get_file_contents'].map((name) => aTool(name, true));

async function aGraphOf(tools: readonly FakeTool[]): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: graphKey, tools });
  onTestFinished(() => fake.close());
  return fake;
}

async function aGraphThatOnlyReads(): Promise<FakeMcpServer> {
  const fake = await aGraphOf(reads);
  const listing = await Effect.runPromise(graphAccessTo(fake.url).listServers(inAlpha, 'graph'));
  for (const { name } of listing.flatMap((server) => ('tools' in server ? server.tools : []))) {
    fake.annotateTool(name, { readOnlyHint: true });
  }
  return fake;
}

const naming = (tools: string) => documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [${tools}]`, 'Judge it.');

function noticesAtSave(tools: Parameters<typeof reasoningAdapter>[0]['tools'], source: string) {
  const { languageModel } = scriptedLanguageModel();
  const capability = reasoningAdapter({ languageModel, ...(tools === undefined ? {} : { tools }) });
  return Effect.runPromise(
    Effect.flatMap(capability.prepare(source), (prepared) => prepared.notices?.(inAlpha) ?? Effect.succeed([])),
  );
}

function listingsOf(fake: FakeMcpServer): number {
  return fake.seen().filter(({ rpc }) => rpc === 'tools/list').length;
}

const expectedDetail =
  'Its tools are all marked reads: graph/search_code and graph/get_file_contents. Choosing what to search, what to open or which hits to read is not exploring: a reasoning function with no tools chooses, and lookups search and read each choice in a `for`. Keep the tools only if its next search depends on what it just read. Move the reads now, or tell the person what it searches for after a read.';

describe('the notice of a reasoning function whose tools are all marked reads, at its save', () => {
  it('names each tool, says that choosing what to search, what to open or which hits to read is not exploring, how lookups take those reads, that only a search that depends on what was just read keeps them, asks to move them or tell the person what it searches for after a read, and points at its tools', async () => {
    const fake = await aGraphOf(reads);

    expect(await noticesAtSave(graphAccessTo(fake.url), naming('graph/search_code, graph/get_file_contents'))).toEqual([
      { kind: 'tools_only_read', detail: expectedDetail, at: '/tools', certainty: 'likely' },
    ]);
  });

  it('is given for every tool of a server, named with server/*, when each is marked reads', async () => {
    const fake = await aGraphThatOnlyReads();

    expect(await noticesAtSave(graphAccessTo(fake.url), naming('graph/*'))).toEqual([
      readToolsNoticeOf([{ server: 'graph', tool: '*' }]),
    ]);
  });
});

describe('no notice of tools marked reads, at a save', () => {
  it('is given when one tool it names may act, named or under server/*', async () => {
    const fake = await aGraphOf([...reads, aTool('create_issue', false)]);
    const access = graphAccessTo(fake.url);

    expect([
      await noticesAtSave(access, naming('graph/search_code, graph/create_issue')),
      await noticesAtSave(access, naming('graph/*')),
    ]).toEqual([[], []]);
  });

  it('is given when what a tool is cannot be known: its server not configured, the tool not listed, or the server not answering', async () => {
    const fake = await aGraphOf(reads);
    const closed = await aGraphOf(reads);
    const closedAccess = graphAccessTo(closed.url);
    await closed.close();

    expect([
      await noticesAtSave(noToolServers, naming('graph/search_code')),
      await noticesAtSave(graphAccessTo(fake.url), naming('graph/search_code, other/search')),
      await noticesAtSave(graphAccessTo(fake.url), naming('graph/search_code, graph/forgotten')),
      await noticesAtSave(closedAccess, naming('graph/search_code')),
    ]).toEqual([[], [], [], []]);
  });

  it('is given, and no server asked, for a function that names no tools', async () => {
    const fake = await aGraphOf(reads);

    expect(await noticesAtSave(graphAccessTo(fake.url), documentOf('model: anthropic/claude-sonnet-4-5'))).toEqual([]);
    expect(listingsOf(fake)).toBe(0);
  });
});

describe('the listing a save asks for the notice of tools marked reads', () => {
  it('lists each server once for a save, and not again while its listing is kept', async () => {
    const fake = await aGraphOf(reads);
    const access = graphAccessTo(fake.url);
    const source = naming('graph/pull_request_read, graph/search_code, graph/get_file_contents');

    await noticesAtSave(access, source);
    const once = listingsOf(fake);
    await noticesAtSave(access, source);

    expect([once, listingsOf(fake)]).toEqual([1, 1]);
  });
});

describe('the words of the notice of tools all marked reads', () => {
  it('fit 400 characters however many tools it names, naming as many as fit and how many more', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ server: 'graph', tool: `read_record_number_${index}` }));

    const { detail } = readToolsNoticeOf(many);

    expect(detail.length).toBeLessThanOrEqual(400);
    expect(detail).toMatch(
      /^Its tools are all marked reads: graph\/read_record_number_0 and 29 more\. Choosing what to search/u,
    );
  });

  it('name each tool once', () => {
    expect(
      readToolsNoticeOf([
        { server: 'graph', tool: 'a' },
        { server: 'graph', tool: 'a' },
      ]).detail,
    ).toMatch(/^Its tools are all marked reads: graph\/a\. /u);
  });
});
