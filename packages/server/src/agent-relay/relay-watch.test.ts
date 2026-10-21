import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeRuntime } from '../testing/relays/fake-runtime.ts';
import { after, ranOnATestClock, relayedTo, runs, settled } from '../testing/relays/relayed-agent.ts';
import { relayBounds } from './relay-bounds.ts';

const { silenceMs, pingTimeoutMs, pingSpacingMs } = relayBounds;

const callTool = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_definition', arguments: {} } };

const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const threeSilentPings = 3 * pingTimeoutMs + 2 * pingSpacingMs;

const unansweredCheck =
  'Auto Runtime stopped answering while it handled this request, so it may or may not have taken effect. Look at the playbook, its definitions and its runs to see whether it did before you send it again.';

describe('a call the runtime is still answering', () => {
  it('is waited for as long as its stream carries a heartbeat, with no ping', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['streams']);
        const relayed = yield* relayedTo(runtime);

        const beatBeforeTheSilence = after(silenceMs - 1).pipe(
          Effect.andThen(
            Effect.sync(() => {
              runtime.beat(3);
            }),
          ),
          Effect.andThen(settled),
        );

        yield* relayed.send(callTool);
        yield* Effect.repeat(beatBeforeTheSilence, { times: 5 });
        runtime.answer(3);

        expect(yield* relayed.next).toMatchObject({ id: 3, result: { tools: [] } });
        expect(relayed.pings()).toBe(0);
      }),
    ));

  it('is waited for after a silence when the runtime answers a ping, so a runtime without a heartbeat is still served', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['streams']);
        const relayed = yield* relayedTo(runtime, { pings: ['silent', 'answers'] });

        yield* relayed.send(callTool);
        yield* after(silenceMs);
        yield* after(pingTimeoutMs + pingSpacingMs);
        runtime.answer(3);

        expect(yield* relayed.next).toMatchObject({ id: 3, result: { tools: [] } });
        expect(relayed.pings()).toBe(2);
        expect(relayed.recoveries()).toEqual([]);
      }),
    ));
});

describe('a call whose runtime stopped answering', () => {
  it('is given up after a silence and three pings unanswered, and answered after the recovery with words to check whether it took effect', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['stays silent']);
        const relayed = yield* relayedTo(runtime, { pings: ['silent', 'silent', 'silent'] });

        yield* relayed.send(callTool);
        yield* after(silenceMs);
        yield* after(threeSilentPings);
        const answer = yield* relayed.next;
        yield* settled;

        expect(answer).toEqual({
          jsonrpc: '2.0',
          id: 3,
          error: { code: -32_603, message: `${unansweredCheck} Auto Runtime runs again.` },
        });
        expect(runtime.aborted()).toEqual([3]);
        expect(relayed.recoveries()).toEqual([{ seen: 'silent', heardBefore: false }]);
      }),
    ));
});

describe('a call whose runtime stopped answering and is being replaced', () => {
  it('is answered at the cap from its arrival, with words that the runtime is being started again', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['stays silent']);
        const relayed = yield* relayedTo(runtime, {
          pings: ['silent', 'silent', 'silent'],
          recoveries: [{ recovery: runs, afterMs: 60_000 }],
        });

        yield* relayed.send(callTool);
        yield* after(silenceMs);
        yield* after(threeSilentPings);
        yield* after(relayBounds.heardBackWithinMs - silenceMs - threeSilentPings);
        const answer = yield* relayed.next;
        yield* after(60_000);

        expect(answer).toEqual({
          jsonrpc: '2.0',
          id: 3,
          error: { code: -32_603, message: `${unansweredCheck} Auto Runtime is being started again.` },
        });
        expect(runtime.sent()).toEqual([callTool]);
      }),
    ));
});

describe('a call whose runtime stopped answering, as the ping finds it', () => {
  it('is given up when the ping finds the port refusing, which the recovery is told', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['stays silent']);
        const relayed = yield* relayedTo(runtime, { pings: ['refused'] });

        yield* relayed.send(callTool);
        yield* after(silenceMs);
        yield* relayed.next;
        yield* settled;

        expect(relayed.recoveries()).toEqual([{ seen: 'refused', heardBefore: false }]);
      }),
    ));

  it('is a list sent again once the recovery makes the runtime run', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['stays silent']);
        const relayed = yield* relayedTo(runtime, { pings: ['silent', 'silent', 'silent'] });

        yield* relayed.send(listTools);
        yield* after(silenceMs);
        yield* after(threeSilentPings);

        expect(yield* relayed.next).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
        expect(runtime.sent()).toEqual([listTools, listTools]);
      }),
    ));
});

describe('calls that fail at once', () => {
  it('share one recovery', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses', 'refuses']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs, afterMs: 1000 }] });

        yield* relayed.send(listTools);
        yield* relayed.send({ ...listTools, id: 4 });
        yield* after(1000);
        const answers = [yield* relayed.next, yield* relayed.next];

        expect(answers).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 4 })]),
        );
        expect(relayed.recoveries()).toHaveLength(1);
      }),
    ));
});

describe('a port that answered before', () => {
  it('is told to the recovery however long ago it answered, and not before it ever did', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses', 'answers', 'refuses']);
        const relayed = yield* relayedTo(runtime, { pings: ['refused', 'refused'] });

        yield* relayed.send(listTools);
        yield* relayed.next;
        yield* after(3_600_000);
        yield* relayed.send(listTools);
        yield* relayed.next;

        expect(relayed.recoveries()).toEqual([
          { seen: 'refused', heardBefore: false },
          { seen: 'refused', heardBefore: true },
        ]);
      }),
    ));
});
