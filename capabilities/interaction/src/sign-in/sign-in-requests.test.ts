import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedSignInRunId, signInAskedBy } from '../sign-in-testing/asked-sign-ins.ts';
import {
  chatSignInDelivery,
  failingSignInDocument,
  signInDocument,
  signInMessage,
  supplierPortal,
} from '../sign-in-testing/sign-in-documents.ts';
import { localDeveloper, priya, priyasAgent, sam } from '../sign-in-testing/sign-in-runs.ts';
import { signInLink, signInTools } from '../sign-in-testing/sign-in-tools.ts';
import { signInAnswerSchema } from './sign-in-schemas.ts';

const listedTimesOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      interactions: Schema.Tuple([Schema.Struct({ requested_at: Schema.String, expires_at: Schema.String })]),
    }),
  }),
);

const declinedBy = (reason: string) => ({
  output: {
    status: 'rejected',
    rejection: {
      reason: 'unanswered',
      kind: 'declined',
      detail: `Priya Shah answered that they did not sign in to ${supplierPortal}${reason}`,
    },
  },
});

describe('a sign-in request', () => {
  it('waits on the person by id, listed with its site and the link where they sign in', async () => {
    const { saved, asked, listed } = await signInAskedBy(priya);

    expect([saved.status, asked]).toMatchObject(['succeeded', { output: { status: 'started' } }]);
    expect(await listed()).toMatchObject({
      output: {
        interactions: [
          {
            run_id: askedSignInRunId,
            to: priya.id,
            delivery: null,
            message: `${signInMessage}\n\n${signInLink}`,
            answer_schema: signInAnswerSchema,
            standing: 'held_for_an_agent',
            sign_in: { server: 'browser', site: supplierPortal, link: signInLink },
          },
        ],
      },
    });
  });

  it('expires when the call said it would, as long after it was asked as the function waits', async () => {
    const { tools, listed } = await signInAskedBy(priya);
    const [{ requested_at: requestedAt, expires_at: expiresAt }] = listedTimesOf(await listed()).output.interactions;

    expect(Date.parse(expiresAt) - Date.parse(requestedAt)).toBeGreaterThan(86_399_000);
    expect(Date.parse(expiresAt) - Date.parse(requestedAt)).toBeLessThanOrEqual(86_400_000);
    expect(tools.signInsAsked()).toMatchObject([
      {
        reference: { server: 'browser', tool: 'browser_sign_in' },
        input: { site: supplierPortal, request: `alpha/${askedSignInRunId}`, until: expiresAt },
      },
    ]);
  });

  it('is delivered through the tool of a connection as written, its message ending with the link', async () => {
    const { tools, settled } = await signInAskedBy(priya, signInDocument({ deliver: chatSignInDelivery }));

    await settled();

    expect(tools.posted()).toMatchObject([{ channel: 'D07Q2KX9B', text: `${signInMessage}\n\n${signInLink}` }]);
  });
});

describe('who answers a sign-in request', () => {
  it('is the person it asks alone, signed_in true never through an agent, and a reason of 500 characters at most', async () => {
    const { answer } = await signInAskedBy(priya);
    const forbidden = { status: 'rejected', reason: 'forbidden' };

    expect([
      await answer(sam, { signed_in: true }),
      await answer(priyasAgent, { signed_in: true }),
      await answer(priya, { signed_in: 'yes' }),
      await answer(priyasAgent, { signed_in: false, reason: 'x'.repeat(501) }),
    ]).toMatchObject([
      {
        ...forbidden,
        detail: `This request asks ${priya.id} to sign in to ${supplierPortal}, and a sign-in request is answered by the person it asks alone`,
      },
      {
        ...forbidden,
        detail:
          'The person signs in through the link the request gives, so signed_in true is taken from their own session and never through an agent; an agent may answer signed_in false, with a reason, when the person will not sign in',
      },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/answer/signed_in' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/answer/reason' }] },
    ]);
  });

  it('takes either answer from the local developer in local mode, where no token names a client', async () => {
    const { answer, settled } = await signInAskedBy(localDeveloper);

    expect(await answer(localDeveloper, { signed_in: true })).toMatchObject({ status: 'succeeded' });
    expect(await settled()).toMatchObject({ output: { status: 'succeeded', output: { signed_in: true } } });
  });
});

describe('the end of a sign-in request the person answered', () => {
  it('succeeds with { signed_in: true } once the person answers from their own session that they signed in', async () => {
    const { answer, settled } = await signInAskedBy(priya);

    expect(await answer(priya, { signed_in: true })).toMatchObject({
      status: 'succeeded',
      output: { answer: { signed_in: true }, answered_by: { id: priya.id, name: priya.name } },
    });
    expect(await settled()).toMatchObject({
      output: {
        status: 'succeeded',
        output: { signed_in: true },
        record: { sign_in: { server: 'browser', site: supplierPortal } },
      },
    });
  });

  it('is unanswered, declined, when the person or their agent answers that they did not sign in, with the reason', async () => {
    const declining = await signInAskedBy(priya);
    const silent = await signInAskedBy(priya);

    await declining.answer(priyasAgent, { signed_in: false, reason: 'My account is locked' });
    await silent.answer(priya, { signed_in: false });

    expect([await declining.settled(), await silent.settled()]).toMatchObject([
      declinedBy(': My account is locked'),
      declinedBy(''),
    ]);
  });
});

describe('the end of a sign-in request nobody answered', () => {
  it('is declined when its cancel is settled after the person declined, and cancelled when nobody answered', async () => {
    const declined = await signInAskedBy(priya);
    const unanswered = await signInAskedBy(priya);
    await declined.answer(priya, { signed_in: false });

    expect([await declined.cancelSettled(), await unanswered.cancelSettled()]).toMatchObject([
      declinedBy(''),
      { output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } } },
    ]);
  });

  it('is unanswered, expired, when nobody answers before it expires', async () => {
    const { settled } = await signInAskedBy(priya);

    expect(await settled(Date.now() + 86_400_001)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
    });
  });
});

describe('a sign-in function whose person is signed in, or whose tool refuses it', () => {
  it('asks nobody when the person is signed in: it ends at once, and lists no request', async () => {
    const tools = signInTools();
    tools.answerSignInWith({ signed_in: true });
    const { asked, listed } = await signInAskedBy(priya, failingSignInDocument(), tools);

    expect(asked).toMatchObject({ output: { status: 'succeeded', output: { signed_in: true } } });
    expect(await listed()).toMatchObject({ output: { interactions: [] } });
  });

  it('is unworkable when the tool refused its arguments', async () => {
    const tools = signInTools();
    tools.refuseSignInArguments('site must be a host name');

    expect((await signInAskedBy(priya, failingSignInDocument(), tools)).asked).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: 'The browser sign in tool of browser refused the arguments: site must be a host name',
    });
  });
});
