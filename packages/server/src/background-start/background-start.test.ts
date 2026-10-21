import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  impatient,
  restartWaitMs,
  startWaitMs,
  stopWaitMs,
  throughARestart,
  type RuntimeFetch,
} from '../local-runtime/runtime-probe.ts';
import {
  computerWith,
  ranProbeByProbe,
  startedForAnAgent,
  startingOn,
  type Computer,
} from '../testing/relays/fake-starting.ts';
import { after, ranOnATestClock, settled } from '../testing/relays/relayed-agent.ts';
import { runningRuntime } from './background-start.ts';

function refusingToStop(fetch: RuntimeFetch): RuntimeFetch {
  return (address, request) =>
    request.method === 'POST' ? Promise.reject(new TypeError('fetch failed')) : fetch(address, request);
}

function stayingUp(computer: Computer): RuntimeFetch {
  return (address, { method }) => {
    if (method === 'POST') {
      computer.record(`asked ${address.slice(address.lastIndexOf('/') + 1)}`);
      return Promise.resolve(Response.json({ status: 'stopping' }, { status: 202 }));
    }
    return Promise.resolve(Response.json(computer.answering()));
  };
}

const unansweredWithinTheStart = {
  words:
    'Auto Runtime did not answer on port 5555 within 60 s of its start; its log is /Users/ada/.auto-runtime/runtime.log',
};

describe('making sure the runtime runs before an agent talks to it', () => {
  it('leaves a runtime that already runs alone', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith(startedForAnAgent);

        expect(yield* runningRuntime(5555, startingOn(computer), impatient)).toBeUndefined();
        expect(computer.events()).toEqual([]);
      }),
    ));

  it('starts one in the background when none runs, holding the lock while it starts', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();

        expect(yield* runningRuntime(5555, startingOn(computer), impatient)).toBeUndefined();
        expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
      }),
    ));

  it('waits for the one another agent is starting instead of starting a second', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const starting = startingOn(computer, { lockTaken: true, comesBackAfter: 3 });

        expect(yield* ranProbeByProbe(runningRuntime(5555, starting, impatient))).toBeUndefined();
        expect(computer.events()).toEqual(['locked']);
        expect(computer.probes()).toBe(4);
      }),
    ));
});

describe('the wait for the runtime an agent starts', () => {
  it('says where its log is once the one it starts did not answer within the wait for a start, and not before', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const starting = yield* Effect.forkChild(
          runningRuntime(5555, startingOn(computer, { startsAs: undefined }), impatient),
        );
        yield* settled;
        yield* after(startWaitMs - 1);
        const justBefore = computer.events();
        yield* after(1);

        expect(yield* Fiber.join(starting)).toEqual(unansweredWithinTheStart);
        expect([justBefore, computer.events()]).toEqual([
          ['locked', 'started'],
          ['locked', 'started', 'unlocked'],
        ]);
      }),
    ));

  it('aborts the probe in flight, frees the lock at once and probes no more once the relay that waited on it was interrupted', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const starting = yield* Effect.forkChild(
          runningRuntime(5555, startingOn(computer, { startsFrozen: true }), impatient),
        );
        yield* settled;
        yield* after(1000);
        const whileItWaits = { events: computer.events(), probes: computer.probes(), aborts: computer.aborts() };
        yield* Fiber.interrupt(starting);
        const onceInterrupted = { events: computer.events(), aborts: computer.aborts() };
        yield* after(startWaitMs);

        expect(whileItWaits).toEqual({ events: ['locked', 'started'], probes: 2, aborts: 0 });
        expect(onceInterrupted).toEqual({ events: ['locked', 'started', 'unlocked'], aborts: 1 });
        expect(computer.probes()).toBe(whileItWaits.probes);
      }),
    ));
});

describe('a runtime an agent finds restarting', () => {
  it('waits for a runtime that is restarting before it starts another', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const starting = startingOn(computer, { comesBackAfter: 5 });

        expect(yield* ranProbeByProbe(runningRuntime(5555, starting, throughARestart))).toBeUndefined();
        expect(computer.events()).toEqual([]);
        expect(computer.probes()).toBe(6);
      }),
    ));

  it('waits through a restart a runtime marked on its port, as long as a restart can take, before it takes the lock', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const starting = yield* Effect.forkChild(
          runningRuntime(5555, startingOn(computer, { restartingOn: 5555 }), impatient),
        );
        yield* settled;
        yield* after(restartWaitMs - 1);
        const throughTheRestart = computer.events();
        yield* after(1);

        expect(yield* Fiber.join(starting)).toBeUndefined();
        expect([throughTheRestart, computer.events()]).toEqual([[], ['locked', 'started', 'unlocked']]);
      }),
    ));

  it('starts one at once past a restart marked on another port, which is not its runtime restarting', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();

        expect(yield* runningRuntime(5555, startingOn(computer, { restartingOn: 19_700 }), impatient)).toBeUndefined();
        expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
      }),
    ));
});

describe('the runtime an agent finds on the port', () => {
  it('connects to a runtime that runs without the controls of the auto-runtime command', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ status: 'ok' });

        expect(yield* runningRuntime(5555, startingOn(computer), impatient)).toBeUndefined();
        expect(computer.events()).toEqual([]);
      }),
    ));

  it('says another program holds the port', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ hello: 'world' });

        expect(yield* runningRuntime(3000, startingOn(computer), impatient)).toEqual({
          words: 'Another program answers on port 3000; set PORT to start Auto Runtime on a free port',
        });
      }),
    ));
});

describe('a newer release of the runtime for an agent', () => {
  it('replaces the older one an agent started', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith(startedForAnAgent);

        expect(yield* runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient)).toBeUndefined();
        expect(computer.events()).toEqual(['asked stop', 'locked', 'started', 'unlocked']);
      }),
    ));

  it('leaves one started in a terminal alone', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ ...startedForAnAgent, started_by: 'terminal' });

        yield* runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient);

        expect(computer.events()).toEqual([]);
      }),
    ));

  it('never replaces a newer one with an older one', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith(startedForAnAgent);

        yield* runningRuntime(5555, startingOn(computer, { version: '0.8.2' }), impatient);

        expect(computer.events()).toEqual([]);
      }),
    ));
});

describe('a newer release of the runtime for an agent, whose older one does not stop', () => {
  it('says so when the older one refuses to stop', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith(startedForAnAgent);
        const starting = startingOn(computer, { version: '0.10.0' });

        expect(yield* runningRuntime(5555, { ...starting, fetch: refusingToStop(starting.fetch) }, impatient)).toEqual({
          words: 'Auto Runtime 0.9.1 on port 5555 did not stop, so Auto Runtime 0.10.0 could not replace it',
        });
        expect(computer.events()).toEqual([]);
      }),
    ));

  it('says so when the older one does not go down within the wait for a stop once asked to', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith(startedForAnAgent);
        const starting = { ...startingOn(computer, { version: '0.10.0' }), fetch: stayingUp(computer) };
        const replacing = yield* Effect.forkChild(runningRuntime(5555, starting, impatient));
        yield* settled;
        yield* after(stopWaitMs);

        expect(yield* Fiber.join(replacing)).toEqual({
          words: 'Auto Runtime 0.9.1 on port 5555 did not stop, so Auto Runtime 0.10.0 could not replace it',
        });
        expect(computer.events()).toEqual(['asked stop']);
      }),
    ));
});

describe('a newer release of the runtime for an agent, while the older one has runs in flight', () => {
  it('leaves the older one running, relays to it, and says that it waits for it to be idle', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ ...startedForAnAgent, runs_in_flight: 2 });

        expect(yield* runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient)).toBeUndefined();
        expect(computer.events()).toEqual([
          'noticed Auto Runtime 0.10.0 waits for Auto Runtime 0.9.1 on port 5555 to be idle before it replaces it, and relays to 0.9.1 until then',
        ]);
      }),
    ));
});
