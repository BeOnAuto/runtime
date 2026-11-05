import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  chatSignInDelivery,
  failingSignInDocument,
  signInDocument,
  signInMessage,
  supplierPortal,
} from '../sign-in-testing/sign-in-documents.ts';
import {
  keyHolder,
  linkedAnswer,
  localDeveloper,
  priya,
  signedInAnswer,
  signedOutAnswer,
  signInRunId,
  signInRuns,
  thePlaybookItself,
} from '../sign-in-testing/sign-in-runs.ts';
import { signInLink } from '../sign-in-testing/sign-in-tools.ts';
import { signInAnswerSchema } from './sign-in-schemas.ts';

const anyText: unknown = expect.any(String);

const startedOnTheRun: unknown = expect.objectContaining({
  call_id: signInRunId,
  server: 'browser',
  tool: 'browser_sign_in',
});

const answeredWithoutError: unknown = expect.objectContaining({ is_error: false });

const signedInRecord = { sign_in: { server: 'browser', site: supplierPortal } };

const deliveredThroughTheChat: unknown = expect.objectContaining({
  deliver: { server: 'chat', tool: 'post_message', with: { channel: 'D07Q2KX9B', text: '{{ message }}' } },
});

const toSam: unknown = expect.objectContaining({ to: 'person:user_9sAm4', answerer: 'person:user_9sAm4' });

const toPriya: unknown = expect.objectContaining({ to: priya.id, answerer: priya.id });

const toTheLocalDeveloper: unknown = expect.objectContaining({ to: 'local', answerer: 'local' });

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

describe('a run of a sign-in function whose person is signed in already', () => {
  it('asks the browser connection once, for the site, the request and until when, and succeeds at once', async () => {
    const { browser, journal, run } = await signInRuns({ answer: signedInAnswer });

    expect(await run(signInDocument())).toEqual(Exit.succeed({ output: { signed_in: true }, record: signedInRecord }));
    expect(browser.received()).toEqual([
      {
        tool: 'browser_sign_in',
        arguments: { site: supplierPortal, request: `alpha/${signInRunId}`, until: anyText },
        meta: { 'auto.on/run_id': signInRunId },
      },
    ]);
    expect(journal.recorded()).toEqual([
      { type: 'tool_call_started', number: 1, data: startedOnTheRun },
      { type: 'tool_call_answered', number: 1, data: answeredWithoutError },
    ]);
  });
});

describe('a run of a sign-in function whose person is not signed in', () => {
  it('waits with a request to the person by id, its message ending with the link on a line of its own', async () => {
    const { browser, run } = await signInRuns({ answer: linkedAnswer });

    expect(await run(signInDocument())).toEqual(
      Exit.succeed({
        finishesLater: true,
        record: {
          to: priya.id,
          message: `${signInMessage}\n\n${signInLink}`,
          answer_schema: signInAnswerSchema,
          answerer: priya.id,
          expires_at: anyText,
          requested_at: anyText,
          sign_in: { server: 'browser', site: supplierPortal, link: signInLink },
        },
      }),
    );
    expect(browser.received()).toHaveLength(1);
  });

  it('keeps the tool of a connection that delivers the request, as written', async () => {
    const { run } = await signInRuns({ answer: linkedAnswer });

    expect(await run(signInDocument({ deliver: chatSignInDelivery }))).toEqual(
      Exit.succeed({
        finishesLater: true,
        record: deliveredThroughTheChat,
      }),
    );
  });
});

describe('a run of a sign-in function that stops at once', () => {
  it('asks only whether the person is signed in, succeeding when they are and ending unanswered, signed_out, when not', async () => {
    const signedIn = await signInRuns({ answer: signedInAnswer });
    const signedOut = await signInRuns({ answer: signedOutAnswer });

    expect([await signedIn.run(failingSignInDocument()), await signedOut.run(failingSignInDocument())]).toEqual([
      Exit.succeed({ output: { signed_in: true }, record: signedInRecord }),
      rejectedWith({
        _tag: 'unanswered',
        kind: 'signed_out',
        detail: `The person the run acts for is not signed in to ${supplierPortal}, and the function stops rather than asks them`,
      }),
    ]);
    expect(signedOut.browser.received()[0]?.arguments).toEqual({ site: supplierPortal, ask: false });
  });
});

describe('the person a run of a sign-in function asks', () => {
  it('is the person in actsFor of a run its caller started as the playbook, as a trigger does, and the local developer in local mode', async () => {
    const { run } = await signInRuns({ answer: linkedAnswer });

    expect([
      await run(signInDocument(), { caller: thePlaybookItself, actsFor: 'person:user_9sAm4' }),
      await run(signInDocument(), { caller: localDeveloper }),
    ]).toEqual([
      Exit.succeed({ finishesLater: true, record: toSam }),
      Exit.succeed({ finishesLater: true, record: toTheLocalDeveloper }),
    ]);
  });

  it('is the caller when the caller is a person, whoever its actsFor names', async () => {
    const { run } = await signInRuns({ answer: linkedAnswer });

    expect(await run(signInDocument(), { caller: priya, actsFor: 'person:user_9sAm4' })).toEqual(
      Exit.succeed({ finishesLater: true, record: toPriya }),
    );
  });
});

describe('the person a run of a sign-in function acts for, when there is none', () => {
  it('is nobody for a run a key started or one that acts for no person, which ends unanswered, no_person, asking nothing', async () => {
    const { browser, journal, run } = await signInRuns({ answer: linkedAnswer });
    const nobody = rejectedWith({
      _tag: 'unanswered',
      kind: 'no_person',
      detail: `The run acts for no person who can sign in to ${supplierPortal}, so nobody was asked: a key started it, or a trigger of a version a key saved or whose person has left the organization`,
    });

    expect([
      await run(signInDocument(), { caller: keyHolder }),
      await run(failingSignInDocument(), { caller: thePlaybookItself }),
    ]).toEqual([nobody, nobody]);
    expect([browser.received(), journal.recorded()]).toEqual([[], []]);
  });

  it('is nobody once the person has left the organization, as the host says through OrgMembership', async () => {
    const asked: (readonly [string, string])[] = [];
    const { browser, run } = await signInRuns({
      answer: linkedAnswer,
      membership: (org, person) => {
        asked.push([org, person]);
        return Effect.succeed(false);
      },
    });
    const left = rejectedWith({
      kind: 'no_person',
      detail: `${priya.id}, whom the run acts for, has left the organization, so nobody was asked to sign in to ${supplierPortal}`,
    });

    expect([
      await run(signInDocument(), { caller: thePlaybookItself, actsFor: priya.id }),
      await run(signInDocument(), { caller: priya }),
    ]).toEqual([left, left]);
    expect([asked, browser.received()]).toEqual([
      [
        ['acme', priya.id],
        ['acme', priya.id],
      ],
      [],
    ]);
  });
});
