import {
  type Capability,
  capabilityContract,
  earliestCapabilityContractServed,
  type PlaybookOperation,
  type PreparedDefinition,
  type RunContext,
} from '@on.auto/definitions';
import { streamAppends, type StreamSignal } from '@on.auto/ledger';
import type { CallResult } from '@on.auto/operations';
import { type RecordedSpan, recordingTracer } from '@on.auto/operations/testing';
import { defaultLimits } from '@on.auto/workflow-engine/testing';
import { Context, Effect, Exit, Function, Schema, Tracer } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { closingBounds } from '../closing/closed-runs.ts';
import type { ContractSix } from '../contract-testing/contract-six.ts';
import type {
  Change,
  ContractFive,
  ContractFour,
  ContractOne,
  ContractThree,
  ContractTwo,
  Row,
} from '../contract-testing/earlier-contracts.ts';
import { tallyFolderOf } from '../folder-testing/tally-folder.ts';
import {
  type CallAnswer,
  type CapabilityDatabase,
  type CapabilityPorts,
  closeHostParts,
  type DueItem,
  type DueWork,
  type Folder,
  type HostClock,
  hostWakeUp,
  type NextWake,
  openHostParts,
  openWorkflowStore,
  type ProvidedCapability,
  rowsOf,
  runKeyOf,
  type RunRequests,
  runRequestsOf,
  statement,
  type Woken,
  type WorkflowStore,
} from '../index.ts';
import { skippingClock } from '../loop/host-clock.ts';
import { someFolder } from '../projector/folder.ts';
import { heldStart, type HeldStart } from '../reaction-testing/held-start.ts';
import {
  definitionRecorded,
  eventTrigger,
  published,
  runOfTheTestsStarted,
} from '../reaction-testing/playbook-writes.ts';
import { reactingStartsAt, steppedMovedClock } from '../reaction-testing/reacting-clock.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { settleAttemptsBeforeBackingOff, settleBackOffMs } from '../settlement/settle-attempts.ts';
import { definitionOfTheTests, runAt, startOf, workflow } from '../testing/host-documents.ts';
import {
  aLedgerInMemory,
  connectedOn,
  leaseHoldersOn,
  onASQLiteFile,
  openedOn,
  type LedgerOn,
} from '../testing/host-files.ts';
import { hostedOn, hostedOnItsClock, hostedStartsAt, recordedOptionsOf } from '../testing/host-runs.ts';
import { signals } from '../testing/signals.ts';
import { endingsToldOf } from '../testing/span-endings.ts';
import { fewSweeps, steppedBy, steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import { watchedClock } from '../testing/watched-clock.ts';
import { counting } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { HostStopped } from './host-gate.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

const notifying = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const approved = { id: 'approved-1', type: 'com.acme.approved' };

const sooner = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const later = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

interface OwnClocked {
  readonly store: WorkflowStore;
  readonly armed: () => readonly number[];
  readonly settled: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly started: (runIdHostParts: string, duration: string) => Promise<unknown>;
  readonly requests: RunRequests;
  readonly wakeUp: (woken: Woken) => Promise<NextWake>;
  readonly closed: () => Promise<void>;
}

async function ownClocked(clock: HostClock): Promise<OwnClocked> {
  const store = await openWorkflowStore(await connectedOn(await aLedgerInMemory()), []);
  const recorded = recordedOptionsOf({ sweepEveryMs: 1000 });
  const armed: number[] = [];
  const parts = openHostParts(store, { ...recorded.options, clock }, (dueAt) => {
    armed.push(dueAt);
  });
  const work = hostWakeUp(parts, { raised: Function.constVoid, renewed: Function.constVoid });
  const requests = runRequestsOf({ database: store.database, clock, serving: () => parts });
  return {
    store,
    armed: () => armed,
    settled: () => [...recorded.settlements().keys()],
    troubles: recorded.troubles,
    started: (runIdHostParts, duration) => {
      recorded.know(runIdHostParts);
      const start = startOf(workflow(`do:\n  - pause: { wait: ${duration} }`));
      return Effect.runPromise(requests.start(runAt(runIdHostParts), start));
    },
    requests,
    wakeUp: (woken) => Effect.runPromise(work.wakeUp(woken)),
    closed: async () => {
      await Effect.runPromise(work.stop());
      await closeHostParts(parts);
    },
  };
}

const ending = workflow('do:\n  - done: { set: { done: true } }');

const outageMs = 2 * 60_000;

const anHourMs = 3_600_000;

const sweepEveryMs = 20;

function toldWhenTheFollowerStops(stopped: () => void): StreamSignal {
  return {
    raise: streamAppends.raise,
    listen: (listener) => {
      const stopListening = streamAppends.listen(listener);
      return () => {
        stopListening();
        stopped();
      };
    },
  };
}

interface StartingReaction {
  readonly held: HeldStart;
  readonly reacting: ReactingHost;
}

async function startingAReaction(
  settings: LedgerOn,
  appended: StreamSignal = streamAppends,
): Promise<StartingReaction> {
  const clock = steppedMovedClock(reactingStartsAt);
  const held = heldStart(clock);
  const reacting = await reactingHost({ settings, clock, start: held.start, sweepEveryMs, appended });
  const trigger = eventTrigger({ type: 'com.acme.closed' });
  await definitionRecorded(reacting.database.store, { name: 'close', version: 1, triggers: [trigger] });
  await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
  await held.begun;
  return { held, reacting };
}

const playbook = { org: 'acme', playbook: 'alpha' };

const calledBy = { runId, reference: '/do/0/ask', run: 1 };

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const CallState = Schema.Struct({ state: Schema.String, delivered: Schema.Number });

const answeredByTheShell: CallResult = { status: 'succeeded', output: 'answered by the shell' };

const answeredAgain: CallResult = { status: 'succeeded', output: 'answered again' };

const refusedForCredits: CallResult = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'This org has used today’s 15 Free plan credits',
  kind: 'credits_exhausted',
  because: 'free_daily_limit',
  admission: 'refused',
};

const waitingForARun = (): Effect.Effect<CallAnswer> => Effect.succeed({ status: 'waiting', child: 'never-started' });

async function partsAnswering(answer: (clock: SteppedClock) => Effect.Effect<CallAnswer>) {
  const clock = steppedClock(hostedStartsAt);
  const store = await openWorkflowStore(await connectedOn(await aLedgerInMemory()), []);
  const recorded = recordedOptionsOf({ answer: () => answer(clock) });
  const parts = openHostParts(
    { database: store.database },
    { ...recorded.options, clock, context: clock.watching() },
    Function.constVoid,
  );
  recorded.know(runId);
  await runOfTheTestsStarted(store.database.store, runId);
  await Effect.runPromise(
    runRequestsOf({ database: store.database, clock, serving: () => parts }).start(runAt(runId), startOf(asking)),
  );
  const callStates = () =>
    Effect.runPromise(rowsOf(CallState, store.database.read(statement`SELECT state, delivered FROM workflow_calls`)));
  const written = (holds: (calls: readonly (typeof CallState.Type)[]) => boolean) =>
    steppedBy(clock, sweepEveryMs).until(callStates, holds, { atMost: 0 });
  const waiting = () => written((calls) => calls.some(({ state }) => state === 'waiting'));
  return { clock, parts, recorded, callStates, written, waiting };
}

const pausedASecond = workflow('do:\n  - pause: { wait: PT1S }');

const runAttributes = { 'auto.on.org': 'acme', 'auto.on.definition.id': definitionOfTheTests, 'auto.on.run_id': runId };

function named(spans: readonly RecordedSpan[], name: string): RecordedSpan | undefined {
  return spans.find((span) => span.name === name);
}

function settledIn(spans: readonly RecordedSpan[]): boolean {
  return spans.some(({ name, ending: endingWorkflowHost }) => name === 'settle' && endingWorkflowHost !== 'open');
}

type RunOfContractSix = ContractSix['runContext'];

interface ContractSeven extends Omit<ContractSix, 'runContext'> {
  readonly runContext: {
    readonly id: string;
    readonly org: string;
    readonly playbook: string;
    readonly caller: RunOfContractSix['caller'];
    readonly definition: { readonly id: string; readonly name: string; readonly version: number };
    readonly journal: RunOfContractSix['journal'];
    readonly lineage: RunOfContractSix['lineage'];
    readonly depth: number;
    readonly callDepth: number;
    readonly calledBy?: NonNullable<RunOfContractSix['calledBy']>;
    readonly trigger?: NonNullable<RunOfContractSix['trigger']>;
    readonly actsFor?: string;
    readonly longestRunOf: RunOfContractSix['longestRunOf'];
    readonly longestRunFor: RunOfContractSix['longestRunFor'];
    readonly resumesAfterOf: RunOfContractSix['resumesAfterOf'];
  };
}

type PreparedOfContractSeven = ContractSeven['prepared'];

interface ContractEight extends Omit<ContractSeven, 'prepared'> {
  readonly prepared: {
    readonly summary: PreparedOfContractSeven['summary'];
    readonly check: PreparedOfContractSeven['check'];
    readonly notices?: NonNullable<PreparedOfContractSeven['notices']>;
    readonly definitionsNamed?: {
      readonly names: readonly { readonly pointer: string; readonly type: string; readonly name: string }[];
      readonly subjects: readonly { readonly pointer: string; readonly type: string; readonly subject: string }[];
      readonly awaited: readonly { readonly pointer: string; readonly type: string; readonly subject: string }[];
    };
    readonly run: PreparedOfContractSeven['run'];
    readonly whenCancelled: PreparedOfContractSeven['whenCancelled'];
    readonly cancelledAttempt: PreparedOfContractSeven['cancelledAttempt'];
    readonly callsTools: PreparedOfContractSeven['callsTools'];
    readonly finishesLaterFor: PreparedOfContractSeven['finishesLaterFor'];
    readonly answersItsShapeFor: PreparedOfContractSeven['answersItsShapeFor'];
    readonly longestRunMs: PreparedOfContractSeven['longestRunMs'];
    readonly longestRunMsFor: PreparedOfContractSeven['longestRunMsFor'];
    readonly resumesAfterMs: PreparedOfContractSeven['resumesAfterMs'];
  };
}

type PreparedOfContractEight = ContractEight['prepared'];

interface ContractNine extends Omit<ContractEight, 'prepared'> {
  readonly prepared: {
    readonly summary: PreparedOfContractEight['summary'];
    readonly check: (place: {
      readonly org: string;
      readonly playbook: string;
      readonly name?: string;
    }) => ReturnType<PreparedOfContractEight['check']>;
    readonly notices?: NonNullable<PreparedOfContractEight['notices']>;
    readonly definitionsNamed?: NonNullable<PreparedOfContractEight['definitionsNamed']>;
    readonly run: PreparedOfContractEight['run'];
    readonly whenCancelled: PreparedOfContractEight['whenCancelled'];
    readonly cancelledAttempt: PreparedOfContractEight['cancelledAttempt'];
    readonly callsTools: PreparedOfContractEight['callsTools'];
    readonly finishesLaterFor: PreparedOfContractEight['finishesLaterFor'];
    readonly answersItsShapeFor: PreparedOfContractEight['answersItsShapeFor'];
    readonly longestRunMs: PreparedOfContractEight['longestRunMs'];
    readonly longestRunMsFor: PreparedOfContractEight['longestRunMsFor'];
    readonly resumesAfterMs: PreparedOfContractEight['resumesAfterMs'];
  };
}

interface TypesOfEachContract {
  readonly 1: ContractOne;
  readonly 2: ContractTwo;
  readonly 3: ContractThree;
  readonly 4: ContractFour;
  readonly 5: ContractFive;
  readonly 6: ContractSix;
  readonly 7: ContractSeven;
  readonly 8: ContractEight;
  readonly 9: ContractNine;
}

type ThisContract = TypesOfEachContract[typeof capabilityContract];

describe('the host asked to start a run', () => {
  it('answers that a run it already started is going, and starts nothing again', async () => {
    const hosted = await hostedOn(await aLedgerInMemory());

    const together = await Effect.runPromise(
      Effect.all([hosted.host.start(run, startOf(listening)), hosted.host.start(run, startOf(listening))], {
        concurrency: 'unbounded',
      }),
    );
    const after = await Effect.runPromise(hosted.host.start(run, startOf(listening)));
    const state = await Effect.runPromise(hosted.host.stateOf(run));

    expect([together.toSorted(), after, state.inputs]).toEqual([['going', 'started'], 'going', 1]);
  });
});

describe('the host given an event', () => {
  it('answers that an event for a run not started yet waits for the start, and takes an event once', async () => {
    const hosted = await hostedOn(await aLedgerInMemory());

    const early = await Effect.runPromise(hosted.host.deliver(run, approved));
    const notStartedIsNotStored = await Effect.runPromise(hosted.host.stateOf(run));
    await Effect.runPromise(hosted.host.start(run, startOf(pausing)));
    const first = await Effect.runPromise(hosted.host.deliver(run, approved));
    const again = await Effect.runPromise(hosted.host.deliver(run, approved));

    expect([early, notStartedIsNotStored.status, first, again]).toEqual([
      'not_started',
      'new',
      'delivered',
      'delivered',
    ]);
  });
});

describe('the host keeping no run loaded', () => {
  it('notes each run it loads from the ledger again, with what the run holds, and not the run it starts', async () => {
    const hosted = await hostedOn(await aLedgerInMemory(), { cacheBounds: { mostRuns: 0, mostBytes: 0 } });

    await Effect.runPromise(hosted.host.start(run, startOf(pausing)));
    const atStart = hosted.notes().length;
    await Effect.runPromise(hosted.host.deliver(run, approved));

    expect(atStart).toBe(0);
    expect(hosted.notes()).toMatchObject([
      {
        kind: 'run_reloaded',
        run: { org: 'acme', definition: definitionOfTheTests, runId },
        snapshot: false,
        events: 1,
      },
    ]);
  });
});

describe('the host reporting to its operator', () => {
  it('reports a run whose run the playbook does not know, once it ends', async () => {
    const hosted = await hostedOn(await aLedgerInMemory());

    await Effect.runPromise(hosted.host.start(run, startOf(listening)));
    await Effect.runPromise(hosted.host.deliver(run, approved));
    const troubles = await hosted.when(hosted.troubles, (reported) => reported.length > 0);

    expect(troubles).toEqual([`${runId} unknown_run`]);
  });

  it('reports a call that broke down before it could answer', async () => {
    const hosted = await hostedOn(await aLedgerInMemory(), {
      answer: () => Effect.die(new Error('The function broke down')),
      sweepEveryMs: 3_600_000,
    });

    await Effect.runPromise(hosted.host.start(run, startOf(notifying)));
    const troubles = await hosted.when(hosted.troubles, (reported) => reported.length > 0);

    expect(troubles).toEqual(['A call could not record its answer']);
  });
});

describe('the host that is stopping', () => {
  it('refuses a start and an event, and stops once', async () => {
    const hosted = await hostedOn(await aLedgerInMemory());

    await Promise.all([hosted.host.stop(), hosted.host.stop()]);
    const refusals = await Effect.runPromise(
      Effect.all([
        Effect.flip(hosted.host.start(run, startOf(listening))),
        Effect.flip(hosted.host.deliver(run, approved)),
      ]),
    );

    expect(refusals).toEqual([new HostStopped({ detail: 'The server is stopping' }), expect.any(HostStopped)]);
  });
});

describe('the parts of a host, woken by a clock of its own', () => {
  it('fire the timers due at each wake-up and answer when they are next due, with no loop and no claim, a day after the first run ended once both have, to close their calls', async () => {
    const start = Date.now();
    const stepped = steppedClock(start);
    const clock = watchedClock(stepped);
    const own = await ownClocked(clock);
    await own.started(sooner, 'PT1S');
    await own.started(later, 'PT2S');

    stepped.step(1000);
    const first = await own.wakeUp({ now: clock.now(), sweep: true });
    const settledAtFirst = own.settled();
    stepped.step(1000);
    const second = await own.wakeUp({ now: clock.now(), sweep: false });
    await own.closed();

    const deadline = start + defaultLimits.mostDurationMs;
    expect(own.armed()).toEqual([deadline, start + 1000, deadline, start + 2000]);
    expect([first, second]).toEqual([{ nextDueAt: start + 2000 }, { nextDueAt: start + 1000 + closingBounds.quietMs }]);
    expect([settledAtFirst, own.settled()]).toEqual([[sooner], [sooner, later]]);
    expect([clock.asked(), await leaseHoldersOn(own.store.database), own.troubles()]).toEqual([[], [], []]);
  });
});

describe('the requests of runs over the parts of a host a clock of its own wakes', () => {
  it('start a run, give it an event and read its state, with no loop and no claim', async () => {
    const clock = steppedClock(Date.now());
    const own = await ownClocked(clock);
    const runHostParts = runAt(sooner);

    const started = await Effect.runPromise(own.requests.start(runHostParts, startOf(listening)));
    const again = await Effect.runPromise(own.requests.start(runHostParts, startOf(listening)));
    const delivered = await Effect.runPromise(
      own.requests.deliver(runHostParts, { id: 'approved-1', type: 'com.acme.approved' }),
    );
    const { status } = await Effect.runPromise(own.requests.stateOf(runKeyOf(runHostParts)));
    await own.closed();

    expect([started, again, delivered, status, await leaseHoldersOn(own.store.database)]).toEqual([
      'started',
      'going',
      'delivered',
      'ended',
      [],
    ]);
  });
});

describe('the host asked to start a run whose settlement is pending', () => {
  it('settles it again at once, and answers settled once it is, whatever a sweep of the host tried meanwhile', async () => {
    const ledger = { down: true };
    const hosted = await hostedOn(await aLedgerInMemory(), {
      sweepEveryMs: 3_600_000,
      ledgerDown: () => ledger.down,
    });
    hosted.know(runId);

    const first = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const attemptsBeforeTheStart = hosted.settleAttempts();
    const whileDown = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const attemptsOfTheStart = hosted.settleAttempts() - attemptsBeforeTheStart;
    ledger.down = false;
    const once = await Effect.runPromise(hosted.host.start(run, startOf(ending)));

    expect([first, whileDown, once]).toEqual(['started', 'going', 'settled']);
    expect(attemptsOfTheStart).toBeGreaterThan(0);
    expect([...hosted.settlements().keys()]).toEqual([runId]);
  });

  it('tries it again at the next sweep after a start found it backing off, rather than a minute later', async () => {
    const attemptOfTheStart = settleAttemptsBeforeBackingOff + 1;
    const attempts = { made: 0 };
    const hosted = await hostedOn(await aLedgerInMemory(), {
      sweepEveryMs: 20,
      ledgerDown: () => {
        attempts.made += 1;
        return attempts.made <= attemptOfTheStart;
      },
    });
    hosted.know(runId);

    await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    await hosted.sweeps.until(hosted.notes, (notes) => notes.length > 0, {
      atMost: settleAttemptsBeforeBackingOff + fewSweeps.atMost,
    });
    const startedAgain = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const settled = await hosted.sweeps.until(hosted.settlements, (settlements) => settlements.size > 0, fewSweeps);

    expect(startedAgain).toBe('going');
    expect([...settled.keys()]).toEqual([runId]);
    expect(hosted.settleAttempts()).toBe(attemptOfTheStart + 1);
  });
});

describe('the host whose ledger cannot be reached for two minutes', () => {
  it('backs off to once a minute, and settles the run once the ledger is back, with nothing done by hand', async () => {
    const clock = skippingClock(1_790_845_200_000, () => Effect.never);
    const outage = { endsAt: Number.POSITIVE_INFINITY };
    const hosted = await hostedOnItsClock(await aLedgerInMemory(), {
      clock,
      sweepEveryMs: 1000,
      ledgerDown: () => clock.now() < outage.endsAt,
    });
    hosted.know(runId);
    outage.endsAt = clock.now() + outageMs;

    await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const notes = await hosted.when(hosted.notes, (noted) => noted.length > 1);

    expect(notes.map(({ kind }) => kind)).toEqual(['settle_backing_off', 'settled_after_back_off']);
    expect([...hosted.settlements().keys()]).toEqual([runId]);
    expect(hosted.settleAttempts()).toBe(settleAttemptsBeforeBackingOff + Math.ceil(outageMs / settleBackOffMs));
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('a reaction starting a run while its host stops serving', () => {
  it('starts the run before the host refuses starts, when the host is told to stop', async () => {
    const { held, reacting } = await startingAReaction(await aLedgerInMemory());

    const stopping = reacting.host.stop();
    held.release(reacting.host);
    await stopping;

    expect(held.exits()).toEqual([Exit.succeed('started')]);
  });

  it('starts the run before the host stands by, when another host takes the workflows over', async () => {
    const settings = await aLedgerInMemory();
    const standingBy = Promise.withResolvers<void>();
    const { held, reacting } = await startingAReaction(settings, toldWhenTheFollowerStops(standingBy.resolve));

    await hostedOn(settings, { holder: 'ahead', clock: steppedClock(reacting.clock.now() + anHourMs) });
    await reacting.clock.atRest();
    reacting.clock.step(sweepEveryMs);
    await standingBy.promise;
    held.release(reacting.host);
    const notes = await reacting.when(reacting.notes, (noted) => noted.length > 0);

    expect(held.exits()).toEqual([Exit.succeed('started')]);
    expect(notes).toMatchObject([{ kind: 'standing_by', holder: 'ahead' }]);
  });
});

describe('a host given a store and the settings of its projector', () => {
  it('keeps the views on that store while it serves, and stops keeping them when it stops', async () => {
    const settings = await onASQLiteFile();
    const views = await viewHarness(settings);
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    const projector = views.settingsOf();
    const store = await openWorkflowStore(await connectedOn(settings), projector.folders);

    const hosted = await hostedOn(store, { projector });
    const kept = await hosted.sweeps.until(
      () => views.viewOf('runs'),
      (read) => read?.folded === 1,
      fewSweeps,
    );
    await hosted.host.stop();

    expect([kept?.phase, kept?.view]).toEqual(['live', 1]);
    expect(hosted.clock.asleep()).toBe(0);
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('a host given the settings of a database and of its projector', () => {
  it('makes the tables of the folders of its projector when it opens its store', async () => {
    const settings = await aLedgerInMemory();
    const folder = tallyFolderOf(1);

    const hosted = await hostedOn(settings, {
      projector: { folders: [someFolder(folder)], playbooksAtOnce: 1, pagesPerWake: 1 },
    });
    await hosted.host.stop();
    const playbooks = await Effect.runPromise(folder.playbooksWithRows(await openedOn(settings)));

    expect(playbooks).toEqual([]);
  });
});

describe('a call that waits for a run the shell learns the answer of, though that run never ended', () => {
  it('takes the answer through the parts once, as its run takes it, and takes no answer after that', async () => {
    const { parts, recorded, callStates, waiting } = await partsAnswering(waitingForARun);
    await waiting();

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredByTheShell));
    const settled = await recorded.when(
      () => recorded.settlements().get(runId),
      (settlement) => settlement !== undefined,
    );
    const tookAgain = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredAgain));
    const calls = await callStates();
    await closeHostParts(parts);

    expect([took, tookAgain]).toEqual([true, false]);
    expect(settled).toEqual({ status: 'succeeded', output: 'answered by the shell' });
    expect(recorded.settlements().get(runId)).toEqual(settled);
    expect(calls).toEqual([{ state: 'answered', delivered: 1 }]);
    expect([recorded.calls().length, recorded.troubles()]).toEqual([1, []]);
  });

  it('takes no answer while it is still running, its wait not yet recorded, and appends nothing', async () => {
    const { parts, recorded, callStates, written } = await partsAnswering((clock) =>
      Effect.andThen(clock.hold().wait, Effect.never),
    );
    await written((calls) => calls.length > 0);

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredByTheShell));
    const calls = await callStates();
    await closeHostParts(parts);

    expect(took).toBe(false);
    expect(calls).toEqual([{ state: 'running', delivered: 0 }]);
    expect(recorded.settlements().get(runId)).toBeUndefined();
  });
});

describe('a call that waits for a run, answered by the shell as an admission refused', () => {
  it('waits at its step and is called again at its retry, under a run of its own', async () => {
    const { clock, parts, recorded, waiting } = await partsAnswering(waitingForARun);
    await waiting();
    const wakeUp = hostWakeUp(parts, { raised: Function.constVoid, renewed: Function.constVoid });

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, refusedForCredits));
    const beforeItsRetry = recorded.calls().length;
    clock.step(60_000);
    await Effect.runPromise(wakeUp.wakeUp({ now: clock.now(), sweep: false }));
    const called = await recorded.when(recorded.calls, (calls) => calls.length > 1);
    await Effect.runPromise(wakeUp.stop());
    await closeHostParts(parts);

    expect([took, beforeItsRetry]).toEqual([true, 1]);
    expect(called.map(({ key }) => key.run)).toEqual([1, 2]);
    expect(recorded.settlements().get(runId)).toBeUndefined();
  });
});

describe('a host opened whole', () => {
  it('opens its parts, takes the claim, wakes them by its loop and lets go of the claim when it stops', async () => {
    const clock = steppedClock(Date.now());
    const settings = await aLedgerInMemory();
    const hosted = await hostedOn(settings, { clock, holder: 'whole', sweepEveryMs: 1000 });
    hosted.know(runId);
    const leases = await openedOn(settings);
    const holdersWhileOpen = await leaseHoldersOn(leases);

    const started = await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausedASecond)));
    clock.step(1000);
    const settled = await hosted.when(hosted.settlements, (settlements) => settlements.size > 0);
    await hosted.host.stop();

    expect([holdersWhileOpen, started, [...settled.keys()], await leaseHoldersOn(leases)]).toEqual([
      ['whole'],
      'started',
      [runId],
      [],
    ]);
  });
});

describe('the host given the context of its server', () => {
  it('traces a start as its input, with the call it makes, the answer and the settlement each beneath the last', async () => {
    const recording = recordingTracer();
    const ended = signals();
    const tracer = endingsToldOf(recording.tracer, ended.changed);
    const hosted = await hostedOn(await aLedgerInMemory(), { context: Context.make(Tracer.Tracer, tracer) });
    hosted.know(runId);

    await Effect.runPromise(Effect.withTracer(hosted.host.start(run, startOf(notifying)), tracer));
    const spans = await ended.when(recording.spans, settledIn);
    const started = named(spans, 'started');
    const call = named(spans, 'call notify');
    const answered = named(spans, 'call_answered');
    const settled = named(spans, 'settle');

    expect(started?.attributes).toMatchObject({ ...runAttributes, 'auto.on.submission': 'applied' });
    expect(call?.attributes).toMatchObject({ ...runAttributes, 'auto.on.call.function': 'notify' });
    expect(settled?.attributes).toMatchObject({
      ...runAttributes,
      'auto.on.settlement.status': 'succeeded',
      'auto.on.settle.receipt': 'recorded',
    });
    expect([call?.parentSpanId, answered?.parentSpanId, settled?.parentSpanId]).toEqual([
      started?.spanId,
      call?.spanId,
      answered?.spanId,
    ]);
  });
});

describe('the host told to stop just after it admitted a start', () => {
  it('lets the start finish, then stops the call it began, so nothing outlives the stop', async () => {
    const answers = { begun: 0, stopped: 0 };
    const answeredOnlyWhenStopped: Effect.Effect<CallResult> = Effect.sync(() => {
      answers.begun += 1;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          answers.stopped += 1;
        }),
      ),
    );
    const hosted = await hostedOn(await aLedgerInMemory(), {
      answer: () => answeredOnlyWhenStopped,
      sweepEveryMs: 3_600_000,
    });

    const starting = Effect.runPromise(
      hosted.host.start(runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'), startOf(notifying)),
    );
    const stopping = hosted.host.stop();
    const started = await starting;
    await stopping;

    expect(started).toBe('started');
    expect(answers).toEqual({ begun: 1, stopped: 1 });
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('the contract by which a capability is made and served', () => {
  it('holds the members and the types its version names, so that a change to either raises capabilityContract', () => {
    expectTypeOf<Capability>().toEqualTypeOf<ThisContract['capability']>();
    expectTypeOf<PreparedDefinition>().toEqualTypeOf<ThisContract['prepared']>();
    expectTypeOf<RunContext>().toEqualTypeOf<ThisContract['runContext']>();
    expectTypeOf<ProvidedCapability>().toEqualTypeOf<ThisContract['provided']>();
    expectTypeOf<CapabilityPorts>().toEqualTypeOf<ThisContract['ports']>();
    expectTypeOf<CapabilityDatabase>().toEqualTypeOf<ThisContract['database']>();
    expectTypeOf<Folder<Row, Change>>().toEqualTypeOf<ThisContract['folder']>();
    expectTypeOf<DueWork>().toEqualTypeOf<ThisContract['dueWork']>();
    expectTypeOf<DueItem>().toEqualTypeOf<ThisContract['dueItem']>();
    expectTypeOf<PlaybookOperation>().toEqualTypeOf<ThisContract['playbookOperation']>();
    expect(capabilityContract).toBe(9);
  });

  it('hands the run and the check of a capability built against any contract it serves every member that contract named, unchanged', () => {
    expectTypeOf<RunContext>().toExtend<ContractTwo['runContext']>();
    expectTypeOf<RunContext>().toExtend<ContractThree['runContext']>();
    expectTypeOf<RunContext>().toExtend<ContractFour['runContext']>();
    expectTypeOf<RunContext>().toExtend<ContractFive['runContext']>();
    expectTypeOf<RunContext>().toExtend<ContractSix['runContext']>();
    expectTypeOf<RunContext>().toExtend<ContractSeven['runContext']>();
    expectTypeOf<PreparedOfContractEight['check']>().toExtend<PreparedDefinition['check']>();
    expect(earliestCapabilityContractServed).toBe(2);
  });
});
