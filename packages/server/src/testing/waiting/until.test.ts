import { steppedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  heardUntilItExits,
  inAWaitsRead,
  nextHappening,
  readByAWait,
  sleepsTold,
  somethingHappened,
} from './happenings.ts';
import { heardFrom, restless, type Resting } from './rest.ts';
import { receiptsTold } from './told-fakes.ts';
import { NothingMoreWillHappen, whenHeld } from './until.ts';

/** A thing the waits hear from, at rest or not as the test says, with work in hand or not. */
function heardThing(): Resting & { rest: () => void; take: () => void; done: () => void } {
  const state = { resting: Promise.withResolvers<void>(), inHand: 0 };
  const resting: Resting & { rest: () => void; take: () => void; done: () => void } = {
    atRest: () => state.resting.promise,
    busy: () => state.inHand > 0,
    rest: () => {
      state.resting.resolve();
    },
    take: () => {
      state.inHand += 1;
    },
    done: () => {
      state.inHand -= 1;
    },
  };
  onTestFinished(heardFrom(resting));
  return resting;
}

interface Counted {
  readonly reads: () => number;
  readonly read: <A>(value: () => A) => () => A;
  /** Answers once the wait has read so many times. */
  readonly readTimes: (times: number) => Promise<void>;
}

function counted(): Counted {
  const count = { reads: 0 };
  const waiting = new Map<number, () => void>();
  return {
    reads: () => count.reads,
    read: (value) => () => {
      count.reads += 1;
      waiting.get(count.reads)?.();
      return value();
    },
    readTimes: (times) => {
      if (count.reads >= times) {
        return Promise.resolve();
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.set(times, resolve);
      return promise;
    },
  };
}

/** A read that holds on its third read, and on its second tells the waits, as a server would while it was read. */
function toldOnItsSecondRead(): () => string {
  const count = { reads: 0 };
  return () => {
    count.reads += 1;
    if (count.reads === 2) {
      somethingHappened();
    }
    return count.reads >= 3 ? 'done' : 'not yet';
  };
}

describe('a wait whose read holds', () => {
  it('answers the value it read, reading once', async () => {
    const reading = counted();

    expect(await whenHeld(reading.read(() => 7))).toBe(7);
    expect(reading.reads()).toBe(1);
  });
});

describe('a wait whose read does not hold yet', () => {
  it('reads again once something else tells, and only then', async () => {
    const reading = counted();
    const kept = { value: 0 };
    const waiting = whenHeld(
      reading.read(() => kept.value),
      (value) => value === 2,
    );
    await reading.readTimes(1);
    kept.value = 1;
    somethingHappened();
    await reading.readTimes(2);
    kept.value = 2;
    somethingHappened();

    expect(await waiting).toBe(2);
    expect(reading.reads()).toBe(3);
  });

  it('reads again after a read that throws, as an expect does', async () => {
    const kept = { value: 0 };
    const reading = counted();
    const waiting = whenHeld(
      reading.read(() => {
        expect(kept.value).toBe(1);
        return kept.value;
      }),
    );
    await reading.readTimes(1);
    kept.value = 1;
    somethingHappened();

    expect(await waiting).toBe(1);
  });
});

describe('the read of a wait', () => {
  it('is marked as a wait read, and nothing outside it is', async () => {
    const inside = await whenHeld(() => inAWaitsRead());

    expect([inside, inAWaitsRead(), await readByAWait(() => Promise.resolve(inAWaitsRead()))]).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe('a wait on what is wholly at rest', () => {
  it.each([
    ['a value that does not hold', () => 'not yet', 'value'],
    ['a read that fails', () => expect.unreachable('the read fails'), 'failure'],
  ])('fails at once on %s, with what it read last', async (_, read, last) => {
    const thing = heardThing();
    thing.rest();

    const failure = await whenHeld(read, (value: unknown) => value === 'done').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NothingMoreWillHappen);
    expect(failure).toHaveProperty(['last', last]);
  });

  it('reads once more at rest, and answers what holds by then', async () => {
    const thing = heardThing();
    const kept = { value: 'not yet' };
    const waiting = whenHeld(
      () => kept.value,
      (value) => value === 'done',
    );
    kept.value = 'done';
    thing.rest();

    expect(await waiting).toBe('done');
  });
});

describe('a wait on what is at rest, told while it read', () => {
  it('reads again where something told while it read at rest', async () => {
    const thing = heardThing();
    thing.rest();

    const held = await whenHeld(toldOnItsSecondRead(), (value) => value === 'done');

    expect(held).toBe('done');
  });

  it('waits on while work is in hand, and reads again once it is told', async () => {
    const thing = heardThing();
    const kept = { value: 'not yet' };
    thing.take();
    thing.rest();
    const waiting = whenHeld(
      () => kept.value,
      (value) => value === 'done',
    );
    kept.value = 'done';
    thing.done();
    somethingHappened();

    expect(await waiting).toBe('done');
  });
});

describe('a wait on what is at rest along with what is not', () => {
  it('waits on while something restless is heard from too', async () => {
    const thing = heardThing();
    onTestFinished(heardFrom(restless(() => false)));
    thing.rest();
    const kept = { value: 'not yet' };
    const waiting = whenHeld(
      () => kept.value,
      (value) => value === 'done',
    );
    kept.value = 'done';
    somethingHappened();

    expect(await waiting).toBe('done');
  });

  it('waits on where the rest cannot be known, as on a stepped clock no host was given', async () => {
    const clock = steppedClock(0);
    onTestFinished(heardFrom({ atRest: clock.atRest, busy: () => false }));
    const kept = { value: 'not yet' };
    const waiting = whenHeld(
      () => kept.value,
      (value) => value === 'done',
    );
    kept.value = 'done';
    somethingHappened();

    expect(await waiting).toBe('done');
  });
});

describe('a wait on a process the test spawned', () => {
  it.each([
    ['exits', () => Promise.resolve(0)],
    ['fails to run', () => Promise.reject(new Error('spawn failed'))],
  ])('fails once the process %s and the read still does not hold', async (_, exited) => {
    heardUntilItExits(exited());

    const failure = await whenHeld(
      () => 'not yet',
      (value) => value === 'done',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NothingMoreWillHappen);
  });
});

describe('the clock a server sleeps on', () => {
  it('tells as a sleep begins and as it ends, where the test moves it', async () => {
    const stepped = steppedClock(0);
    const clock = sleepsTold(stepped);
    const begun = nextHappening();
    const sleeping = Effect.runPromise(clock.sleep(1000));
    await begun;
    const ended = nextHappening();
    await stepped.asleepAtLeast(1);
    stepped.step(1000);
    await sleeping;

    await expect(ended).resolves.toBeUndefined();
  });
});

/** A fake that records what it sees and receives, answering `once` as a fake MCP server does. */
function recordingFake() {
  const seen: string[] = [];
  const received: string[] = [];
  const watchers = new Set<() => boolean>();
  return {
    seen: () => seen,
    received: () => received,
    once: (holds: () => boolean) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      watchers.add(() => holds() && (resolve(), true));
      return promise;
    },
    record: (into: 'seen' | 'received', what: string) => {
      (into === 'seen' ? seen : received).push(what);
      for (const watch of watchers) {
        if (watch()) {
          watchers.delete(watch);
        }
      }
    },
  };
}

describe('a fake told of', () => {
  it('tells the waits of each request it sees and each call it receives', async () => {
    const fake = receiptsTold(recordingFake());
    const first = nextHappening();
    fake.record('seen', 'tools/list');
    await first;
    const second = nextHappening();
    fake.record('received', 'post_message');

    await expect(second).resolves.toBeUndefined();
    expect(fake.received()).toEqual(['post_message']);
  });
});
