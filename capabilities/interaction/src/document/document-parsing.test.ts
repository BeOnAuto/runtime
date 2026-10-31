import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, notificationDocument } from '../testing/index.ts';
import { requestDocumentOf } from '../testing/route-documents.ts';
import { parseInteractionDocument } from './document-parsing.ts';

function problemsOf(source: string): readonly string[] {
  const parsed = parseInteractionDocument(source, standingRenderClock);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}

function documentWith(frontMatter: readonly string[], body = 'Approve {{ input.campaign }}?'): string {
  return ['---', ...frontMatter, '---', body].join('\n');
}

const essentials = ["to: '{{ input.owner }}'", 'expires: P2D'];

const keys = 'description, call, to, from, expires, deliver, replies, input, output, reply';

describe('an interaction function definition', () => {
  it('reads its party, expiry, schemas and message, and is for an agent with deliver: agent', () => {
    const parsed = requestDocumentOf(approvalDocument());

    expect(parsed).toMatchObject({
      description: 'Ask the campaign owner to approve a brief',
      expires: 'P2D',
      expiresMs: 172_800_000,
      output: { schema: { document: { required: ['choice'] } } },
    });
    expect([parsed.route, parsed.heldForAnAgent]).toEqual([undefined, { said: true, line: 5 }]);
    expect(parsed.to.variables.map(({ path }) => path)).toEqual([['input', 'owner']]);
    expect(parsed.message.variables.map(({ path }) => path)).toEqual([['input', 'campaign']]);
  });

  it('reads a request that names no way to its party as one for an agent, keeping where the way is unsaid for its save', () => {
    const parsed = requestDocumentOf(approvalDocument([]));

    expect([parsed.route, parsed.heldForAnAgent]).toEqual([undefined, { said: false, line: 2 }]);
  });

  it('refuses a deliver that is neither agent nor the block of a tool', () => {
    expect(problemsOf(documentWith([...essentials, 'deliver: agents']))).toEqual([
      'Line 4, /deliver: Expected agent, or the server, tool and with of the tool that sends the request',
    ]);
  });

  it('is a notification when it gives no answer schema', () => {
    expect(Result.getOrThrow(parseInteractionDocument(notificationDocument(), standingRenderClock)).output).toEqual({});
  });

  it.each(['channel', 'model', 'tools', 'language', 'config'])(
    'refuses %s, a key it does not take, with its line',
    (key) => {
      expect(problemsOf(documentWith([...essentials, `${key}: x`]))).toEqual([
        `Line 4, /${key}: ${key} is not a key of the front matter; it takes ${keys}`,
      ]);
    },
  );
});

function expiresOf(expires: string): number {
  return requestDocumentOf(documentWith(["to: 'x'", `expires: ${expires}`])).expiresMs;
}

describe('the expiry of a definition', () => {
  it('takes one minute and thirty days exactly, the bounds of a request', () => {
    expect([expiresOf('PT1M'), expiresOf('P30D')]).toEqual([60_000, 2_592_000_000]);
  });

  it('refuses an expiry outside its bounds or not a duration', () => {
    const bounds = 'A request expires after a duration from one minute to thirty days, such as P2D or PT4H';

    expect([
      problemsOf(documentWith(["to: 'x'", 'expires: PT30S'])),
      problemsOf(documentWith(["to: 'x'", 'expires: P31D'])),
      problemsOf(documentWith(["to: 'x'", 'expires: two days'])),
    ]).toEqual([
      [`Line 3, /expires: PT30S is not a time a request may wait. ${bounds}`],
      [`Line 3, /expires: P31D is not a time a request may wait. ${bounds}`],
      [`Line 3, /expires: two days is not an ISO 8601 duration. ${bounds}`],
    ]);
  });
});

describe('a definition that names neither the tool it calls nor the party it asks', () => {
  it('refuses a request without its party or its expiry, and an empty front matter, in words that name call', () => {
    expect([
      problemsOf(documentWith(['description: Ask someone'])),
      problemsOf(documentWith(["to: '{{ input.owner }}'"])),
      problemsOf('---\n---\nHello'),
    ]).toEqual([
      [
        'Line 2, /to: to is required, the party the request goes to, unless the function asks a system with call',
        'Line 2, /expires: expires is required, how long the request waits, unless the function asks a system with call',
      ],
      [
        'Line 2, /expires: expires is required, how long the request waits, unless the function asks a system with call',
      ],
      [
        'Line 2: The front matter is empty; it names at least the tool it calls, or the party it goes to and when it expires',
      ],
    ]);
  });
});

describe('the refusals of a definition', () => {
  it('refuse a party or a message that does not compile, or reads what a request does not have', () => {
    expect([
      problemsOf(documentWith(["to: '{{ input.owner'", 'expires: P2D'])),
      problemsOf(documentWith(["to: '{{ owner }}'", 'expires: P2D'])),
      problemsOf(documentWith(essentials, 'Hello {{ person }}')),
      problemsOf(documentWith(essentials, 'Hello {% if %}')),
    ]).toEqual([
      [expect.stringMatching(/^Line 2, \/to: /u)],
      [
        'Line 2, /to: owner is not a variable of the party of a request, which reads input, today and now; assign it first',
      ],
      [
        'Line 5: person is not a variable of the message of a request, which reads input, today and now; assign it first',
      ],
      [expect.stringMatching(/^Line 5: /u)],
    ]);
  });

  it('refuse a property a closed input schema does not have, in the party and in the message', () => {
    const closed = [
      'input:',
      '  schema: { type: object, additionalProperties: false, properties: { owner: { type: string } } }',
    ];

    expect(problemsOf(documentWith([...essentials, ...closed], 'For {{ input.campaign }}'))).toEqual([
      'Line 7: input.campaign is not a property of the input schema, which allows no others',
    ]);
  });
});

describe('the refusals of the form of a definition', () => {
  it('refuse a definition without a message, a schema that is not one, and front matter of the wrong types', () => {
    expect([
      problemsOf(documentWith(essentials, '  ')),
      problemsOf(documentWith([...essentials, 'output:', '  schema: { type: thing }'])),
      problemsOf(documentWith(['to: 3', 'expires: P2D'], '')),
      problemsOf("to: 'x'"),
      problemsOf('---\n---\nHello'),
    ]).toEqual([
      ['Line 5: The definition has no message: write it after the front matter'],
      [expect.stringMatching(/^Line 5, \/output\/schema/u)],
      ['Line 2, /to: Expected string', 'Line 5: The definition has no message: write it after the front matter'],
      [
        'Line 1: An interaction function definition starts with a line of three dashes (---) that opens its front matter of YAML',
      ],
      [expect.stringContaining('the party it goes to and when it expires')],
    ]);
  });

  it('refuses a message of more than 1,000 names, and an input schema it cannot compile', () => {
    expect([
      problemsOf(documentWith(essentials, '{{ input.a }}'.repeat(600))),
      problemsOf(documentWith([...essentials, 'input:', '  schema: { type: thing }'])),
    ]).toEqual([
      [expect.stringContaining('A template may use at most 1000 names')],
      [expect.stringMatching(/^Line 5, \/input\/schema/u)],
    ]);
  });
});
