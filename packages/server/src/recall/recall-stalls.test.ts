import { plainTextIn, problemIn, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  playbookWithReviews,
  inState,
  liveAt,
  liveWith,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';

const reviewRuns =
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: reasoning/review-brief\nview:\n  initial: 0';

const takingObjectsOnly = [
  'export function fold(view: any, event: any): any {',
  "  if (typeof event.data.output === 'string') {",
  '    throw new Error(`cannot take ${event.data.output}`);',
  '  }',
  '  return view + 1;',
  '}',
].join('\n');

const decodeStalled = Schema.decodeUnknownSync(
  Schema.Struct({
    standing: Schema.Struct({
      folded: Schema.Number,
      stalled: Schema.Struct({
        event: Schema.Struct({ id: Schema.String, type: Schema.String, time: Schema.String }),
        kind: Schema.String,
        error: Schema.String,
        line: Schema.Number,
      }),
    }),
  }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function stalledServer(): Promise<ReasoningServer> {
  const server = await servingRecall(
    verdicts({ campaign: 'spring', verdict: 'approve' }, 'the secret plan of the spring campaign'),
  );
  closing.push(server.stop);
  await playbookWithReviews(server);
  await server.call('POST', `${alpha}/definitions/recall`, {
    body: { name: 'objects', source: recallDocument(takingObjectsOnly, reviewRuns) },
  });
  await reviewed(server, 2);
  return server;
}

describe('a recall function whose view stalled', () => {
  it('stands stalled with the event, the kind and the raw error, and holds back no other view of the playbook', async () => {
    const server = await stalledServer();

    const standing = decodeStalled(await standingUntil(server, 'objects', inState('stalled'))).standing;
    await standingUntil(server, 'reviews', liveWith(2));
    const reviews = await recalled(server, 'reviews', { campaign: 'unknown' });

    expect(standing).toMatchObject({
      folded: 1,
      stalled: { event: { type: 'run_succeeded' }, kind: 'raised', line: 12 },
    });
    expect(standing.stalled.error).toBe('Error: cannot take the secret plan of the spring campaign');
    expect(reviews).toMatchObject({ status: 200, body: { output: [{ verdict: 'none' }] } });
  });

  it('answers a conflict, stalled, in fixed words with the type and time of the event and the line, never its values or id', async () => {
    const server = await stalledServer();
    const { stalled } = decodeStalled(await standingUntil(server, 'objects', inState('stalled'))).standing;

    const ran = await recalled(server, 'objects', {});

    expect(ran).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        kind: 'stalled',
        detail: `The view of the recall function “objects” stopped at the run_succeeded event of ${stalled.event.time}: its fold raised an error on line 12. Save a corrected version to build the view again from the playbook's history`,
      },
    });
    expect(ran.text).not.toContain('secret');
    expect(ran.text).not.toContain(stalled.event.id);
  });
});

describe('a recall function whose view stalled, afterwards', () => {
  it('is repaired by saving a corrected version, which builds the view again from the history', async () => {
    const server = await stalledServer();
    await standingUntil(server, 'objects', inState('stalled'));

    await server.call('PUT', `${alpha}/definitions/recall/objects`, {
      body: { source: recallDocument(foldOf('return view + 1;'), reviewRuns) },
    });
    await standingUntil(server, 'objects', liveAt(2));

    expect(await recalled(server, 'objects', {})).toMatchObject({ status: 200, body: { output: 2 } });
  });

  it('tells an agent over MCP of the conflict and its kind in plain words', async () => {
    const server = await stalledServer();
    await standingUntil(server, 'objects', inState('stalled'));

    const ran = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) => session.callTool('run_definition', { type: 'recall', name: 'objects', input: {} }),
    );

    expect({ isError: ran.isError, problem: problemIn(ran) }).toMatchObject({
      isError: true,
      problem: { status: 409, reason: 'conflict', kind: 'stalled' },
    });
    expect(internalTermsIn(plainTextIn(ran))).toEqual([]);
    expect(plainTextIn(ran)).not.toContain('secret');
  });
});
