import type { ArrivedEvent } from '@on.auto/api';
import { connectionWake } from '@on.auto/interaction';
import { readOnce, theChannel } from '@on.auto/interaction/testing';
import { Conflict } from '@on.auto/operations';
import type { ConnectionArrival, TakeIn } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { handedOnBy, wokenBy } from './served-events.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const fiveSeconds = 5000;

const subscription = { topic: theChannel, id: 'hook-7' };

const posted = { type: 'com.example.chat.post', id: 'P-3', subject: theChannel, data: { words: 'Ship it' } };

function arrivedReading(reading: ArrivedEvent['reading'], carried?: ArrivedEvent['carried']): ArrivedEvent {
  return {
    address: { org: 'acme', playbook: 'alpha', connection: 'chat' },
    reading,
    arrival: { transport: 'request', headers: {}, query: {} },
    provesTheBodyAndATime: false,
    subscription,
    ...(carried === undefined ? {} : { carried }),
  };
}

type Consumer = (event: ArrivedEvent) => Effect.Effect<unknown>;

async function consumedAt(consumerOf: (wake: ReturnType<typeof connectionWake>) => Consumer, arrived: ArrivedEvent) {
  const waiting = await readOnce(runId);
  const before = await waiting.row();
  const answer = await Effect.runPromise(
    TestClock.setTime(waiting.readAt).pipe(
      Effect.andThen(consumerOf(connectionWake({ ledger: waiting.playbook.ledger.service }))(arrived)),
      Effect.provide(TestClock.layer()),
    ),
  );
  return { before, after: await waiting.row(), readAt: waiting.readAt, answer };
}

function wokenAt(reading: ArrivedEvent['reading']) {
  return consumedAt(wokenBy, arrivedReading(reading));
}

function takingIn(answered: ReturnType<TakeIn>) {
  const handed: ConnectionArrival[] = [];
  const takeIn: TakeIn = (arrival) => {
    handed.push(arrival);
    return answered;
  };
  return { handed, takeIn };
}

describe('a delivery the events address proves, tied to the subscription whose secret proves it', () => {
  it('makes the conversation it names, waiting through its connection, due the shortest wait of its reading after it arrives', async () => {
    const { before, after, readAt } = await wokenAt({ wake: { conversation: theChannel } });

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
  });

  it('makes every conversation waiting through its connection due where it names none, as a subscription’s may', async () => {
    const { before, after, readAt } = await wokenAt({ wake: { subscription: 'hook-7' } });

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
  });

  it('wakes nothing where its reading holds no wake', async () => {
    const { before, after } = await wokenAt({ connection: { account: 'W-9' } });

    expect(after).toEqual(before);
  });
});

const carrying = { event: posted, topic: theChannel };

const wakingAndCarrying = arrivedReading({ wake: { conversation: theChannel }, event: posted }, carrying);

function handedTo(takeIn: TakeIn, arrived = wakingAndCarrying) {
  return consumedAt((wake) => handedOnBy(wake, takeIn), arrived);
}

describe('a proven delivery that carries an event, handed on by the server', () => {
  it('makes the conversation it names due as before, then hands the intake its event, its connection and its subscription’s topic, once', async () => {
    const taking = takingIn(Effect.succeed({ outcome: 'taken' }));

    const { before, after, readAt, answer } = await handedTo(taking.takeIn);

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
    expect(taking.handed).toEqual([
      { playbook: { org: 'acme', playbook: 'alpha' }, connection: 'chat', event: posted, topic: theChannel },
    ]);
    expect(answer).toBe('decided');
  });

  it('answers as decided what the intake does not take or refuses, and hands it nothing where no event is carried', async () => {
    const notTaken = takingIn(Effect.succeed({ outcome: 'not_taken', reasons: ['no_trigger'] }));
    const refused = takingIn(Effect.succeed({ outcome: 'refused' }));
    const unhanded = takingIn(Effect.succeed({ outcome: 'taken' }));

    const answers = [
      (await handedTo(notTaken.takeIn)).answer,
      (await handedTo(refused.takeIn)).answer,
      (await handedTo(unhanded.takeIn, arrivedReading({ event: posted }))).answer,
    ];

    expect(answers).toEqual(['decided', 'decided', 'decided']);
    expect([notTaken.handed.length, refused.handed.length, unhanded.handed]).toEqual([1, 1, []]);
  });
});

describe('a proven delivery that carries an event the intake cannot decide on', () => {
  it('still makes the conversation it names due, the wake being asked first', async () => {
    const { before, after, readAt } = await handedTo(takingIn(Effect.die(new Error('The database is gone'))).takeIn);

    expect(after).toEqual({ ...before, due_at: readAt + fiveSeconds });
  });

  it('answers why the intake did not decide: the tag of its failure, a defect, or that it was cut off', async () => {
    const failing = [
      Effect.fail(new Conflict({ detail: 'The stream kept changing' })),
      Effect.die(new Error('The database is gone')),
      Effect.interrupt,
    ];

    const answers = await Promise.all(
      failing.map(async (answered) => (await handedTo(takingIn(answered).takeIn)).answer),
    );

    expect(answers).toEqual([{ undecided: 'conflict' }, { undecided: 'defect' }, { undecided: 'interrupted' }]);
  });
});
