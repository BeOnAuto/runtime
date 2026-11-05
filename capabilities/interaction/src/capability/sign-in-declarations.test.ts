import { longestCallRunMs } from '@on.auto/definitions/tool-blocks';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  chatSignInDelivery,
  failingSignInDocument,
  signInDocument,
  supplierPortal,
} from '../sign-in-testing/sign-in-documents.ts';
import { signedInSchema } from '../sign-in/sign-in-schemas.ts';
import { noTools } from '../testing/index.ts';
import { makeInteractionFunctionAdapter } from './interaction-function.ts';

const capability = makeInteractionFunctionAdapter({
  tools: noTools,
  openRequests: () => Effect.succeed(0),
  mostOpenRequests: 10,
});

function preparedOf(source: string) {
  return Effect.runPromise(capability.prepare(source));
}

describe('what a sign-in function declares', () => {
  it('calls tools, and finishes later, at the latest when its request expires, only when it waits for the person', async () => {
    const waiting = await preparedOf(signInDocument());
    const stopping = await preparedOf(failingSignInDocument());

    expect(
      [waiting, stopping].map(({ callsTools, finishesLaterFor, longestRunMs }) => [
        callsTools,
        finishesLaterFor({}),
        longestRunMs,
      ]),
    ).toEqual([
      [true, true, 86_400_000],
      [true, false, longestCallRunMs],
    ]);
  });

  it('sums up its server, its site, its answers and the one output it gives', async () => {
    const summaries = await Promise.all(
      [
        signInDocument(),
        signInDocument({ deliver: chatSignInDelivery }),
        failingSignInDocument(),
        signInDocument({ ifSignedOut: null }),
      ].map(async (source) => (await preparedOf(source)).summary),
    );
    const site = { server: 'browser', site: supplierPortal };

    expect(summaries.map(({ details }) => details)).toEqual([
      { sign_in: { ...site, if_signed_out: 'ask' }, expires: 'P1D' },
      { sign_in: { ...site, if_signed_out: 'ask' }, expires: 'P1D', deliver: { server: 'chat', tool: 'post_message' } },
      { sign_in: { ...site, if_signed_out: 'fail' } },
      { sign_in: site },
    ]);
    expect(summaries[0]?.outputSchema).toEqual(signedInSchema);
  });
});

describe('the words of a sign-in function', () => {
  it('show its request waiting for the person to sign in, and its output as the person signed in', () => {
    const request = {
      to: 'person:user_7kLm2',
      message: 'Sign in, please.',
      answer_schema: { type: 'object' },
      answerer: 'person:user_7kLm2',
      expires_at: '2026-10-08T09:00:00.000Z',
      requested_at: '2026-10-07T09:00:00.000Z',
      sign_in: { server: 'browser', site: supplierPortal, link: 'https://studio.example/sign-in' },
    };

    expect([
      capability.runWords.deferral(request)?.summary,
      capability.describeOutput({ signed_in: true }, { sign_in: { server: 'browser', site: supplierPortal } }),
    ]).toEqual([
      `A sign-in request is waiting for the person it asks to sign in to ${supplierPortal}, held for an agent, until 2026-10-08T09:00:00.000Z.`,
      `The person it acts for is signed in to ${supplierPortal}.`,
    ]);
  });
});
