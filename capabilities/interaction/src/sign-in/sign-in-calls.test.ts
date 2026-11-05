import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { failingSignInDocument, signInDocument, supplierPortal } from '../sign-in-testing/sign-in-documents.ts';
import {
  answered,
  linkedAnswer,
  signedInAnswer,
  signedOutAnswer,
  signInRuns,
} from '../sign-in-testing/sign-in-runs.ts';

const theTool = 'The browser sign in tool of browser';

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

describe('a run of a sign-in function whose browser connection cannot be asked', () => {
  it('is unavailable, sending nothing, when the server does not serve the playbook or cannot be reached', async () => {
    const { browser, journal, run } = await signInRuns({ answer: linkedAnswer });
    const unserved = await run(signInDocument({ server: 'browsers' }));
    await browser.close();

    expect([unserved, await run(failingSignInDocument())]).toEqual([
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_server_not_configured' }),
      rejectedWith({ kind: 'tool_server_failed', because: 'unreachable' }),
    ]);
    expect(journal.recorded()).toEqual([]);
  });

  it('is unavailable as requests_full, asking nothing, when the playbook holds as many open requests as it may', async () => {
    const { browser, run } = await signInRuns({ answer: linkedAnswer, openRequests: 10 });

    expect(await run(signInDocument())).toEqual(rejectedWith({ kind: 'requests_full' }));
    expect(browser.received()).toEqual([]);
  });
});

describe('a run of a sign-in function that cannot make its request', () => {
  it('is unworkable before the call when an argument of its delivery does not render', async () => {
    const { browser, run } = await signInRuns({ answer: linkedAnswer });
    const delivering = [
      'deliver:',
      '  server: chat',
      '  tool: post_message',
      '  with:',
      "    channel: '{{ input.channel }}'",
    ];

    expect(await run(signInDocument({ deliver: delivering }))).toEqual(
      rejectedWith({ kind: 'unworkable', record: { pointer: '/deliver/with/channel' } }),
    );
    expect(browser.received()).toEqual([]);
  });

  it('is unworkable once the call answered, when the message and the link take more than a request may hold', async () => {
    const { browser, run } = await signInRuns({ answer: linkedAnswer });
    const tooLong: unknown = expect.stringMatching(
      /^The message with the link where the person signs in takes \d+ bytes, more than the 8192 a request may hold$/u,
    );

    expect(await run(signInDocument({ body: 'x'.repeat(8150) }))).toEqual(
      rejectedWith({ kind: 'unworkable', detail: tooLong }),
    );
    expect(browser.received()).toHaveLength(1);
  });
});

describe('a run of a sign-in function whose call does not finish', () => {
  it('is unavailable, tools_unfinished, whatever the mark of the tool, after a tool error or a server that failed', async () => {
    const erring = await signInRuns({
      answer: () => ({ isError: true, content: [{ type: 'text', text: 'The browser is busy' }] }),
    });
    const failing = await signInRuns({ answer: signedInAnswer });
    failing.browser.answerNextOf('tools/call', 500);
    const serverFailed: unknown = expect.stringMatching(
      /^The tool server browser failed: .*, after the run called the browser sign in tool of browser$/u,
    );

    expect([await erring.run(signInDocument()), await failing.run(failingSignInDocument())]).toEqual([
      rejectedWith({
        kind: 'tools_unfinished',
        because: 'tool_error',
        detail: `${theTool} answered an error: The browser is busy`,
      }),
      rejectedWith({ kind: 'tools_unfinished', because: 'server_failed', detail: serverFailed }),
    ]);
  });

  it('keeps the wait a 429 asked for past the longest a run waits', async () => {
    const { browser, run } = await signInRuns({ answer: signedInAnswer });
    browser.answerNextOf('tools/call', 429, 1, { 'retry-after': '20' });

    expect(await run(signInDocument())).toEqual(
      rejectedWith({ kind: 'tools_unfinished', because: 'server_failed', record: { retry_after_ms: 20_000 } }),
    );
  });
});

describe('a run of a sign-in function whose call answered what it cannot use', () => {
  it('is unworkable for an answer of neither shape, a link that is not http or https, and no link where it asks', async () => {
    const odd = await signInRuns({ answer: () => answered({ ok: true }) });
    const elsewhere = await signInRuns({ answer: () => answered({ signed_in: false, link: 'javascript:alert(1)' }) });
    const unlinked = await signInRuns({ answer: signedOutAnswer });

    expect([
      await odd.run(signInDocument()),
      await elsewhere.run(signInDocument()),
      await unlinked.run(signInDocument()),
    ]).toEqual([
      rejectedWith({
        kind: 'unworkable',
        detail: `${theTool} answered neither { "signed_in": true }, { "signed_in": false } nor a link where the person signs in`,
      }),
      rejectedWith({ kind: 'unworkable', detail: `${theTool} answered a link that is not an http or https address` }),
      rejectedWith({
        kind: 'unworkable',
        detail: `The person the run acts for is not signed in to ${supplierPortal}, and browser_sign_in gave no link where they sign in`,
      }),
    ]);
  });
});

describe('a run of a sign-in function that it cannot start', () => {
  it('checks its input against its input schema first', async () => {
    const { browser, run } = await signInRuns({ answer: linkedAnswer });
    const weekly = ['input:', '  schema: { type: object, required: [week], properties: { week: { type: string } } }'];

    expect(await run(signInDocument({ front: weekly }), { input: { week: 41 } })).toEqual(
      rejectedWith({ _tag: 'invalid_input' }),
    );
    expect(browser.received()).toEqual([]);
  });

  it('is unworkable for a document that leaves out what a save asks, which no save takes', async () => {
    const { run } = await signInRuns({ answer: linkedAnswer });

    expect(await run(signInDocument({ ifSignedOut: null }))).toEqual(
      rejectedWith({
        kind: 'unworkable',
        detail:
          'The sign-in function leaves out sign_in.if_signed_out, which a save asks the person for; save it again with their answer',
      }),
    );
  });
});
