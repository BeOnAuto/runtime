import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  chatSignInDelivery,
  failingSignInDocument,
  signInDocument,
  signInMessage,
} from '../sign-in-testing/sign-in-documents.ts';
import { signedInSchema } from '../sign-in/sign-in-schemas.ts';
import { reading } from '../testing/route-documents.ts';
import { parseInteractionDocument } from './document-parsing.ts';
import type { SignInDocument } from './interaction-document.ts';

function signInOf(source: string): SignInDocument {
  const parsed = Result.getOrThrow(parseInteractionDocument(source, standingRenderClock));
  if (parsed.shape !== 'sign_in') {
    throw new Error(`Expected a sign-in function, read a function of the shape ${parsed.shape}`);
  }
  return parsed;
}

const anInputSchemaProblem: unknown = expect.stringMatching(/^Line 7, \/input\/schema\/type: /u);

const aYamlProblem: unknown = expect.stringMatching(/^Line 2: /u);

function signInWritten(lines: readonly string[]): string {
  return ['---', 'sign_in:', '  server: browser', '  site: portal.supplier.example', ...lines, '---', ''].join('\n');
}

function problemsOf(source: string): readonly string[] {
  const parsed = parseInteractionDocument(source, standingRenderClock);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}

describe('a sign-in function that waits for the person', () => {
  it('reads its server, its site, how long it waits and its message, held for an agent with deliver: agent', () => {
    const parsed = signInOf(signInDocument());

    expect(parsed).toMatchObject({
      shape: 'sign_in',
      description: 'Makes sure the person the stock check runs for is signed in to the supplier portal',
      signIn: { server: 'browser', site: 'portal.supplier.example' },
      input: {},
      whenSignedOut: { answer: 'ask', asking: { expires: 'P1D', expiresMs: 86_400_000 } },
      output: { schema: { document: signedInSchema } },
    });
    expect(parsed.whenSignedOut).not.toHaveProperty('asking.route');
    expect(parsed.whenSignedOut).toHaveProperty('asking.message.text', signInMessage);
  });

  it('reads the tool of a connection that sends it, as every request names one', () => {
    expect(signInOf(signInDocument({ deliver: chatSignInDelivery })).whenSignedOut).toMatchObject({
      answer: 'ask',
      asking: { route: { deliver: { server: 'chat', tool: 'post_message' } } },
    });
  });

  it('refuses a body it cannot render and one it leaves out', () => {
    expect([
      problemsOf(
        signInDocument({
          body: 'Sign in for {{ input.week }}.',
          front: ['input:', '  schema: { type: object, properties: {}, additionalProperties: false }'],
        }),
      ),
      problemsOf(signInDocument({ body: '' })),
    ]).toEqual([
      ['Line 12: input.week is not a property of the input schema, which allows no others'],
      ['Line 10: The definition has no message: write it after the front matter'],
    ]);
  });
});

describe('a sign-in function that stops at once', () => {
  it('reads as one that asks nobody, with a description or without one', () => {
    expect([signInOf(failingSignInDocument()), signInOf(signInWritten(['  if_signed_out: fail']))]).toMatchObject([
      { description: 'Makes sure the person the stock check runs for is signed in to the supplier portal' },
      { whenSignedOut: { answer: 'fail' } },
    ]);
    expect(signInOf(signInWritten(['  if_signed_out: fail']))).not.toHaveProperty('description');
  });

  it('refuses an input schema it cannot compile, with its line', () => {
    expect(problemsOf(signInWritten(['  if_signed_out: fail', 'input:', '  schema: { type: nothing }']))).toEqual([
      anInputSchemaProblem,
    ]);
  });

  it('refuses expires, deliver and a message, since it asks nobody', () => {
    expect(problemsOf(signInDocument({ ifSignedOut: 'fail' }))).toEqual([
      'Line 7, /expires: A sign-in function with if_signed_out: fail asks nobody, so it takes no expires',
      'Line 8, /deliver: A sign-in function with if_signed_out: fail asks nobody, so it takes no deliver',
      'Line 10: A sign-in function with if_signed_out: fail asks nobody and sends no message: leave the body after the front matter empty',
    ]);
  });
});

describe('a sign-in function that leaves out what a save asks the person', () => {
  it('reads as unsaid, with the first question and the line it is asked at', () => {
    expect([
      signInOf(signInDocument({ ifSignedOut: null })).whenSignedOut,
      signInOf(signInDocument({ deliver: [] })).whenSignedOut,
      signInOf(signInDocument({ expires: null })).whenSignedOut,
      signInOf(signInDocument({ ifSignedOut: null, expires: null, deliver: [], body: '' })).whenSignedOut,
    ]).toEqual([
      { answer: 'unsaid', question: 'if_signed_out', line: 4 },
      { answer: 'unsaid', question: 'deliver', line: 1 },
      { answer: 'unsaid', question: 'expires', line: 1 },
      { answer: 'unsaid', question: 'if_signed_out', line: 4 },
    ]);
  });

  it('still refuses what it writes that no answer would make right', () => {
    expect(
      problemsOf(
        signInDocument({
          ifSignedOut: null,
          expires: 'P31D',
          deliver: ['deliver:', '  server: Chat', '  tool: post_message', '  with: {}'],
          body: 'Sign in {% if %}',
        }),
      ),
    ).toEqual([
      'Line 6, /expires: P31D is not a time a request may wait. A request expires after a duration from one minute to thirty days, such as P2D or PT4H',
      `Line 8, /deliver/server: Expected a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter`,
      'Line 12: invalid value expression: ""',
    ]);
  });
});

describe('the fields a sign-in function refuses', () => {
  it('refuses to, from, call, replies, reply and output.schema, each with its line and why', () => {
    expect(
      problemsOf(
        signInDocument({
          deliver: chatSignInDelivery,
          front: [
            "to: 'ada'",
            "from: 'ada'",
            'call: { server: chat, tool: thread_replies }',
            ...reading,
            'reply: { choice: word }',
            'output:',
            '  schema: { type: object }',
          ],
        }),
      ),
    ).toEqual([
      'Line 14, /to: A sign-in function asks the person the run acts for, so to would name someone else',
      'Line 15, /from: A sign-in function asks the person the run acts for, so from would name someone else',
      'Line 16, /call: A sign-in function calls the sign-in tool of its server itself, so it takes no call',
      'Line 18, /replies: A sign-in is answered by the person signing in, never by a reply, so replies has nothing to read',
      'Line 35, /reply: A sign-in is answered by the person signing in, never by a reply, so reply has nothing to read',
      'Line 37, /output/schema: A sign-in function answers { "signed_in": true } once the person is signed in, so it takes no output.schema of its own',
    ]);
  });
});

describe('the site and the server of a sign-in function', () => {
  const siteWords =
    'sign_in.site is the host name of the site, such as portal.supplier.example, written as text and never as a template: lower case, without a scheme, a path or a port, at most 253 bytes';

  it.each([
    'Portal.Supplier.example',
    'https://portal.supplier.example',
    'portal.supplier.example/orders',
    'portal.supplier.example:443',
    "'{{ input.site }}'",
    '-portal.example',
    ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(63)].join('.'),
  ])('refuses %s as the site', (site) => {
    expect(problemsOf(signInDocument({ site }))).toEqual([`Line 5, /sign_in/site: ${siteWords}`]);
  });

  it.each(['localhost', 'intranet.local', '10.0.0.5', 'xn--bcher-kva.example'])('takes %s as the site', (site) => {
    expect(signInOf(signInDocument({ site })).signIn.site).toBe(site);
  });

  it('refuses a server that is not the name of one, and an answer that is neither ask nor fail', () => {
    expect([
      problemsOf(signInDocument({ server: 'Browser Tools' })),
      problemsOf(signInWritten(['  if_signed_out: wait'])),
    ]).toEqual([
      [
        'Line 4, /sign_in/server: Expected a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      ],
      ['Line 5, /sign_in/if_signed_out: Expected ask, to wait for the person, or fail, to stop at once'],
    ]);
  });

  it('refuses a key it does not take under sign_in, and says nothing of the message while its front matter is refused', () => {
    expect([
      problemsOf(signInWritten(['  if_signed_out: fail', '  url: https://portal.supplier.example'])),
      problemsOf(['---', 'sign_in: [', '---', ''].join('\n')),
    ]).toEqual([
      ['Line 6, /sign_in/url: url is not a key of sign_in; it takes server, site, if_signed_out'],
      [aYamlProblem],
    ]);
  });
});
