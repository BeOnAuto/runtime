import { stoppedWords } from '@on.auto/api';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';
import { fakeRuntime, type Turn } from '../testing/relays/fake-runtime.ts';
import { after, ranOnATestClock, relayedTo, runs, settled } from '../testing/relays/relayed-agent.ts';
import { heldTooLongWords } from './resend-rule.ts';

const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const callTool = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_definition', arguments: {} } };

const leftAlone: Recovery = {
  runs: false,
  words: 'Auto Runtime did not start on port 5555; its log is ~/.auto-runtime/runtime.log',
};

function refusal(id: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code: -32_603, message } };
}

const check = (mayHaveTakenEffect: string) =>
  `${mayHaveTakenEffect}. Look at the playbook, its definitions and its runs to see whether it did before you send it again.`;

const stoppedMidCall = check(stoppedWords);

const pausedFor =
  'Auto Runtime stopped soon after each of the last 3 times this connection started it, within 10 minutes, so it starts it no more until those minutes have passed. Ask the person to read ~/.auto-runtime/runtime.log, which says why, and to fix what it says.';

const notKilled =
  'Auto Runtime on port 5555 does not answer, and process 4343, which this connection started, did not end even after SIGKILL. Ask the person to end it, then send the request again.';

const notStartedHere =
  'Auto Runtime on port 5555 does not answer, and this connection did not start it, so it leaves it alone. Ask the person to stop the program that holds port 5555, then send the request again.';

describe('a request the runtime refused to connect for', () => {
  it('never reached it, so it is sent again once the shared recovery makes sure the runtime runs', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toMatchObject({ id: 3, result: { tools: [] } });
        expect(runtime.sent()).toEqual([callTool, callTool]);
        expect(relayed.recoveries()).toEqual([{ seen: 'answers', heardBefore: true }]);
      }),
    ));

  it('is answered with why the runtime does not run when the recovery cannot make it', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses']);
        const relayed = yield* relayedTo(runtime, { pings: ['refused'], recoveries: [{ recovery: leftAlone }] });

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toEqual(refusal(3, leftAlone.words));
        expect(runtime.sent()).toEqual([callTool]);
        expect(relayed.recoveries()).toEqual([{ seen: 'refused', heardBefore: false }]);
      }),
    ));
});

describe('a request the runtime turned away before it ran anything', () => {
  it('is answered with what the recovery found, never sent again', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['turns away']);
        const credential = { runs: false, words: 'Auto Runtime on port 5555 asks for a credential' };
        const relayed = yield* relayedTo(runtime, {
          pings: ['asks for a credential'],
          recoveries: [{ recovery: credential }],
        });

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toEqual(refusal(3, credential.words));
        expect(runtime.sent()).toEqual([callTool]);
      }),
    ));

  it.each<readonly [Turn, string]>([
    ['turns away with a problem', 'Auto Runtime turned this request away: The body is too large'],
    ['turns away', 'Auto Runtime turned this request away with HTTP 401'],
  ])('is answered, when the runtime %s and still runs, with what the runtime said', (turn, said) =>
    ranOnATestClock(
      Effect.gen(function* () {
        const relayed = yield* relayedTo(fakeRuntime([turn]));

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toEqual(refusal(3, said));
      }),
    ),
  );
});

describe('a tool call that may have reached the runtime before it stopped, once the runtime is recovered', () => {
  it.each<readonly [string, Recovery, string]>([
    ['runs again', runs, 'Auto Runtime runs again.'],
    ['could not be started', leftAlone, leftAlone.words],
    ['starts no more while its starts keep ending', { runs: false, words: pausedFor }, pausedFor],
    ['did not end even after SIGKILL', { runs: false, words: notKilled }, notKilled],
    ['is left alone', { runs: false, words: notStartedHere }, notStartedHere],
  ])('is answered once, after the recovery, with words to check and that the runtime %s', (_case, recovery, outcome) =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['cuts']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery, afterMs: 10_000 }] });

        yield* relayed.send(callTool);
        yield* after(10_000);
        const answer = yield* relayed.next;
        yield* relayed.send(listTools);

        expect(answer).toEqual(refusal(3, `${stoppedMidCall} ${outcome}`));
        expect(yield* relayed.next).toMatchObject({ id: 2 });
        expect(runtime.sent()).toEqual([callTool, listTools]);
      }),
    ),
  );
});

describe('a tool call that may have reached the runtime before it stopped, while the runtime is not yet recovered', () => {
  it.each<Turn>(['cuts', 'ends unanswered'])(
    'is answered at the cap from its arrival, when its stream %s and the recovery takes longer, never sent again',
    (turn) =>
      ranOnATestClock(
        Effect.gen(function* () {
          const runtime = fakeRuntime([turn]);
          const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs, afterMs: 60_000 }] });

          yield* relayed.send(callTool);
          yield* after(45_000);
          const answer = yield* relayed.next;
          yield* after(15_000);

          expect(answer).toEqual(refusal(3, `${stoppedMidCall} Auto Runtime is still being started.`));
          expect(runtime.sent()).toEqual([callTool]);
          expect(relayed.recoveries()).toHaveLength(1);
        }),
      ),
  );
});

describe('a list that may have reached the runtime before it stopped', () => {
  it('is sent again once the runtime runs, since listing twice changes nothing', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['cuts']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs }] });

        yield* relayed.send(listTools);

        expect(yield* relayed.next).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
        expect(runtime.sent()).toEqual([listTools, listTools]);
      }),
    ));
});

describe('a request the relay holds while the runtime is being started', () => {
  it.each<readonly [string, Turn, string]>([
    ['was not sent, when it never reached the runtime', 'refuses', heldTooLongWords(false, false)],
    ['was not answered, when it may have reached it', 'cuts', heldTooLongWords(true, false)],
  ])(
    'is answered within the time the agent waits, and not sent after it, with words that it %s',
    (_case, turn, words) =>
      ranOnATestClock(
        Effect.gen(function* () {
          const runtime = fakeRuntime([turn]);
          const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs, afterMs: 60_000 }] });

          yield* relayed.send(listTools);
          yield* after(45_000);
          const answer = yield* relayed.next;
          yield* after(15_000);

          expect(answer).toEqual(refusal(2, words));
          expect(runtime.sent()).toEqual([listTools]);
        }),
      ),
  );

  it('is never sent and answered nothing once the agent cancels it, so the runtime receives it once at most', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs, afterMs: 10_000 }] });

        yield* relayed.send(callTool);
        yield* after(2000);
        yield* relayed.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } });
        yield* after(10_000);
        yield* relayed.send(listTools);
        yield* settled;

        expect(yield* relayed.next).toMatchObject({ id: 2 });
        expect(runtime.sent()).toEqual([callTool, listTools]);
      }),
    ));
});

describe('a request the runtime answered with its stop, as it closed its endpoint mid-call', () => {
  it('is a tool call held and answered once, with words to check whether it took effect and the outcome, never sent again', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['answers that it stopped']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs, afterMs: 1000 }] });

        yield* relayed.send(callTool);
        yield* after(1000);
        const answer = yield* relayed.next;
        yield* relayed.send(listTools);

        expect(answer).toEqual(refusal(3, `${stoppedMidCall} Auto Runtime runs again.`));
        expect(yield* relayed.next).toMatchObject({ id: 2 });
        expect(runtime.sent()).toEqual([callTool, listTools]);
      }),
    ));

  it('is a list sent again once the runtime runs, since listing twice changes nothing', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['answers that it stopped']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(listTools);

        expect(yield* relayed.next).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
        expect(runtime.sent()).toEqual([listTools, listTools]);
      }),
    ));
});

describe('a request a stopping runtime turned away before it handled it', () => {
  it('never arrived, so a tool call is sent again once the shared recovery makes sure the runtime runs', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['turns away while it stops']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toMatchObject({ id: 3, result: { tools: [] } });
        expect(runtime.sent()).toEqual([callTool, callTool]);
      }),
    ));
});

describe('a request refused while another runtime took the port first', () => {
  it('is sent to the runtime on the port, since it never reached one', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses']);
        const tookThePort: Recovery = {
          runs: false,
          words:
            'Another Auto Runtime took port 5555 first, so the one this connection started ended. Send the request again: it goes to the one on the port.',
          anotherAnswers: true,
        };
        const relayed = yield* relayedTo(runtime, { pings: ['refused'], recoveries: [{ recovery: tookThePort }] });

        yield* relayed.send(callTool);

        expect(yield* relayed.next).toMatchObject({ id: 3, result: { tools: [] } });
        expect(runtime.sent()).toEqual([callTool, callTool]);
      }),
    ));
});
