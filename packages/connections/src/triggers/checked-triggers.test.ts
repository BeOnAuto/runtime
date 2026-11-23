import { generationOf, isPolled } from '@on.auto/providers';
import { cardMoved } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostSubscriptionsThroughAConnection } from '../subscriptions/loop-ports.ts';
import { subscriptionRecordsOf } from '../subscriptions/subscription-records.ts';
import { alpha, at, boardsReportingTo, type BoardsReporting } from '../testing/boards-connections.ts';
import { boardsSentBy, byChecking, theServerWithAnAddress } from '../testing/boards-reported.ts';
import { nothingReceived } from './connection-hearing.ts';

const checking = { destinations: [byChecking] };

const theBoard = { connection: 'boards', subject: 'board-7' } as const;

interface Asked {
  readonly connection: string;
  readonly subject: string;
  readonly paused?: boolean;
}

async function standingIn({ events }: Pick<BoardsReporting, 'events'>, { connection, subject, paused = false }: Asked) {
  const standing = await at(events.standingOf(alpha, { connection, type: cardMoved.type, paused, subject }));
  return { ...standing, notListeningBecause: standing.notListeningBecause?.kind ?? null };
}

function declaredOfTheCheck(): string {
  const polled = (boardsSentBy(byChecking).events?.destinations ?? []).find((destination) => isPolled(destination));
  return polled === undefined ? '' : generationOf(undefined, polled).declared;
}

describe('a trigger of an app that tells Auto', () => {
  it('stands at the speed of what the app tells, with no pace', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);
    const standing = await standingIn(reporting, theBoard);

    expect([standing.speed, 'pollingIntervalSeconds' in standing]).toEqual(['instant', false]);
  });
});

describe('a trigger of an app Auto checks on a timer', () => {
  it('is heard wherever the runtime runs, and counts its place among those of its connection', async () => {
    const { events } = await boardsReportingTo(nothingReceived, checking);
    const reported = events.reportingOf(alpha, 'boards').pipe(Effect.flatMap(Effect.fromNullishOr), Effect.orDie);

    expect(await at(Effect.flatMap(reported, (each) => each.hearing(cardMoved.type, 'board-7')))).toEqual({
      kind: 'heard',
      subscribes: { topic: 'board-7', mostTopics: mostSubscriptionsThroughAConnection },
    });
  });

  it('stands at the pace of its checks, making its first check until its starting point is set, then listening', async () => {
    const reporting = await boardsReportingTo(nothingReceived, checking);
    const before = await standingIn(reporting, theBoard);
    const made = { type: 'polling', declared: declaredOfTheCheck(), since: '' } as const;
    await at(
      subscriptionRecordsOf(reporting.subscriptions).made(alpha, { connection: 'boards', topic: 'board-7' }, made),
    );

    expect([before, await standingIn(reporting, theBoard)]).toMatchObject([
      { speed: 'polling', pollingIntervalSeconds: 120, listening: false, notListeningBecause: 'setting_up' },
      { speed: 'polling', pollingIntervalSeconds: 120, listening: true, notListeningBecause: null },
    ]);
  });
});

interface NotListening {
  readonly stands: string;
  readonly asked: Asked;
  readonly kind: string;
}

const notListening: readonly NotListening[] = [
  { stands: 'a broken connection', asked: { connection: 'mended', subject: 'board-7' }, kind: 'connection_broken' },
  { stands: 'a paused workflow', asked: { ...theBoard, paused: true }, kind: 'workflow_paused' },
];

describe('a trigger of an app Auto checks, not listening', () => {
  it.each(notListening)('is not listening for $stands, as an instant trigger is not', async ({ asked, kind }) => {
    const reporting = await boardsReportingTo(nothingReceived, checking);

    expect(await standingIn(reporting, asked)).toMatchObject({ speed: 'polling', notListeningBecause: kind });
  });
});
