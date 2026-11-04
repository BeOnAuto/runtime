import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument, runsDocument } from '../testing/index.ts';
import { parseLookupDocument } from './document-parsing.ts';

const anOpenSchema: unknown = expect.objectContaining({ document: {} });

function problemsOf(source: string): readonly string[] {
  return Result.match(parseLookupDocument(source, standingRenderClock), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('a lookup function document', () => {
  it('reads its call, the line it starts on and its schemas as written', () => {
    const parsed = Result.getOrThrow(parseLookupDocument(lookupDocument(), standingRenderClock));

    expect(parsed).toMatchObject({
      description: 'Read the replies of a thread in the team chat, oldest first',
      call: {
        server: 'chat',
        tool: 'thread',
        with: { channel: '{{ input.channel }}', ts: '{{ input.thread }}', limit: 100, inclusive: false },
        read: '/messages',
      },
      callLine: 4,
      input: { schema: { document: { type: 'object' } } },
      output: { schema: { document: { type: 'array' } } },
    });
  });

  it('takes a call without arguments, read, a description or an input schema', () => {
    const plain = ['---', 'call:', '  server: chat', '  tool: thread', 'output:', '  schema: {}', '---', ''].join('\n');

    expect([problemsOf(plain), problemsOf(lookupDocument({ with: [], read: null }))]).toEqual([[], []]);
    expect(Result.getOrThrow(parseLookupDocument(plain, standingRenderClock))).toEqual({
      kind: 'call',
      call: { server: 'chat', tool: 'thread' },
      callLine: 3,
      input: {},
      output: { schema: anOpenSchema },
    });
  });
});

describe('the keys a lookup function document refuses', () => {
  it('refuses a document without call or runs, or with empty front matter', () => {
    const uncalled = ['---', 'output:', '  schema: {}', '---', ''].join('\n');

    expect([problemsOf(uncalled), problemsOf('---\n---\n')]).toEqual([
      [
        'Line 1: A lookup function takes call, to read through one tool, or runs, to read the outputs of the runs of a definition of this playbook',
      ],
      ['Line 2: The front matter is empty; it names at least the tool it reads through or the runs it reads'],
    ]);
  });

  it.each([
    ["to: '{{ input.owner }}'", 'to'],
    ['expires: P2D', 'expires'],
    ['deliver: agent', 'deliver'],
    ['model: claude', 'model'],
  ])('refuses %s, a key no lookup function takes, at its line', (line, key) => {
    expect(problemsOf(lookupDocument({ front: [line] }))).toEqual([
      expect.toSatisfy((problem: string) => problem.startsWith(`Line 12, /${key}: ${key} is not a key`)),
    ]);
  });

  it('refuses a key of call it does not hold, and a lookup without an output schema, at the call', () => {
    expect([
      problemsOf(lookupDocument({ with: ['    channel: C0123'], front: ['  limit: 3'] })),
      problemsOf(lookupDocument({ output: [] })),
    ]).toEqual([
      ['Line 9, /call/limit: limit is not a key of call; it takes server, tool, with, read'],
      ['Line 4, /call: A lookup function answers with what its tool answered, so output.schema says what that is'],
    ]);
  });
});

describe('the parts of a lookup function document it refuses', () => {
  it('refuses a body at its first written line, beside a refused front matter too', () => {
    const noBody =
      'Line 33: A lookup function sends no message and asks no model: leave the body after the front matter empty, and say what the function does in description';

    expect([
      problemsOf(lookupDocument({ body: '\n\nRead {{ input.channel }}' })),
      problemsOf(lookupDocument({ front: ['expires: P2D'], body: '\n\nRead it' })),
      problemsOf(['---', 'call: [', '---', 'Read it'].join('\n')),
    ]).toEqual([
      [noBody],
      [
        expect.stringContaining('/expires: expires is not a key'),
        expect.stringContaining('A lookup function sends no message'),
      ],
      [expect.stringMatching(/^Line 2/u), expect.stringContaining('A lookup function sends no message')],
    ]);
  });

  it('refuses an input or an output schema it cannot compile, at its line', () => {
    expect([
      problemsOf(lookupDocument({ input: ['input:', '  schema: { type: thing }'] })),
      problemsOf(lookupDocument({ output: ['output:', '  schema: { type: thing }'] })),
    ]).toEqual([
      [expect.stringMatching(/^Line 13, \/input\/schema/u)],
      [expect.stringMatching(/^Line 20, \/output\/schema/u)],
    ]);
  });

  it('refuses a call its block refuses, its names, its pointer and its arguments', () => {
    expect([
      problemsOf(lookupDocument({ server: 'Chat' })),
      problemsOf(lookupDocument({ read: 'messages' })),
      problemsOf(lookupDocument({ with: ["    channel: '{{ to }}'"] })),
    ]).toEqual([
      [expect.stringMatching(/^Line 4, \/call\/server: Expected a server name/u)],
      [expect.stringMatching(/^Line 11, \/call\/read: Expected a JSON Pointer/u)],
      ['Line 7, /call/with/channel: Reads to, which a template of a call does not have; it reads input, today and now'],
    ]);
  });
});

const description = 'Reads the paces computed for one campaign since a day, newest first';

describe('a lookup function document that reads runs', () => {
  it('reads the definition whose runs it reads, and its words and since as templates at their pointers', () => {
    const parsed = Result.getOrThrow(parseLookupDocument(runsDocument(), standingRenderClock));

    expect(parsed).toMatchObject({
      description,
      kind: 'runs',
      runs: {
        type: 'computation',
        name: 'campaign-pace',
        words: { pointer: '/runs/words' },
        since: { pointer: '/runs/since' },
      },
      input: { schema: { document: { type: 'object' } } },
    });
    expect(parsed).not.toHaveProperty('output');
  });

  it('takes runs without words or since, and literal ones within their bounds, of any definition type', () => {
    const plain = runsDocument({ words: null, since: null, input: [] });

    expect(Result.getOrThrow(parseLookupDocument(plain, standingRenderClock))).toEqual({
      description,
      kind: 'runs',
      runs: { type: 'computation', name: 'campaign-pace' },
      input: {},
    });
    expect([
      problemsOf(runsDocument({ words: 'spring-sale', since: '2026-10-01', input: [] })),
      problemsOf(runsDocument({ type: 'workflow', since: "'2026-10-01T09:00:00+02:00'" })),
      problemsOf(runsDocument({ since: "'{{ today }}'" })),
    ]).toEqual([[], [], []]);
  });
});

describe('the runs a lookup function document refuses', () => {
  it('refuses call beside runs, an output schema beside runs, and an input default, at their lines', () => {
    expect([
      problemsOf(runsDocument({ front: ['call:', '  server: chat', '  tool: thread'] })),
      problemsOf(runsDocument({ front: ['output:', '  schema: {}'] })),
      problemsOf(runsDocument({ input: ['input:', '  default: {}'] })),
    ]).toEqual([
      [
        'Line 4, /runs: A lookup function reads through one tool or from the runs of one definition, so it takes call or runs, not both',
      ],
      [
        'Line 9, /output/schema: A lookup function that reads runs answers with their outputs in a shape of its own, so it takes no output.schema',
      ],
      ['Line 9, /input/default: default is not a key of input; it takes schema'],
    ]);
  });

  it('refuses a type that is not the type of a definition, a name that is not one, and a key runs does not take', () => {
    expect([
      problemsOf(runsDocument({ type: 'thing', name: 'Campaign pace' })),
      problemsOf(runsDocument({ front: ['  limit: 3'] })),
    ]).toEqual([
      [
        expect.stringMatching(
          /^Line 4, \/runs\/type: Expected the type of a definition: reasoning, lookup, .+, or workflow$/u,
        ),
        'Line 5, /runs/name: Expected the name of a definition: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
      ],
      ['Line 8, /runs/limit: limit is not a key of runs; it takes type, name, words, since'],
    ]);
  });
});

describe('the words and since a lookup function document refuses', () => {
  it('refuses literal words and a literal since past their bounds, at their lines', () => {
    expect([
      problemsOf(runsDocument({ words: 'x'.repeat(1001), since: 'yesterday' })),
      problemsOf(runsDocument({ since: '2026-02-30' })),
    ]).toEqual([
      [
        'Line 6, /runs/words: runs.words takes at most 1,000 characters, and these take 1,001',
        'Line 7, /runs/since: runs.since takes a day, such as 2026-10-01, or a date and time with its offset, such as 2026-10-01T09:00:00Z, and "yesterday" is neither',
      ],
      [
        'Line 7, /runs/since: runs.since takes a day, such as 2026-10-01, or a date and time with its offset, such as 2026-10-01T09:00:00Z, and "2026-02-30" is neither',
      ],
    ]);
  });

  it('refuses a template that reads what it does not have, or that does not compile, at its line', () => {
    expect([
      problemsOf(runsDocument({ words: "'{{ to }}'" })),
      problemsOf(runsDocument({ words: "'{{ input.campaign'" })),
    ]).toEqual([
      ['Line 6, /runs/words: Reads to, which a template of runs does not have; it reads input, today and now'],
      ['Line 6, /runs/words: output "{{ input.campaign" not closed'],
    ]);
  });
});
