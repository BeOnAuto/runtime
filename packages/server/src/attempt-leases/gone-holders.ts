import { runCorrelationIn } from '@on.auto/definitions';
import { deadAttemptEnder, holdingAttemptIn, type HoldingAttempt } from '@on.auto/definitions/attempts';
import type { CallersById } from '@on.auto/identity';
import { Ledger, playbookCallerOf, type CallerIdentity, type PlaybookRequest } from '@on.auto/operations';
import {
  attemptLeasesOn,
  attemptKeyOfRun,
  type AttemptLeaseSettings,
  type GoneHolders,
  type RunInAPlaybook,
  type WorkflowStore,
} from '@on.auto/workflow-host';
import { Effect } from 'effect';

import type { HostRuntime } from '../workflows/host-dependencies.ts';
import type { HostDispatches } from '../workflows/host-operations.ts';
import { inRuntime } from '../workflows/in-runtime.ts';

export interface GoneHolderParts {
  readonly runtime: HostRuntime;
  readonly store: WorkflowStore;
  readonly holding: AttemptLeaseSettings;
  readonly callers: CallersById;
  readonly dispatches: Pick<HostDispatches, 'nextAttempt' | 'refusedAttempt'>;
}

function streamAddressOf({ org, playbook, runId }: RunInAPlaybook) {
  return { org, playbook, id: runId };
}

function withNoGrant(org: string, id: string): CallerIdentity {
  return { id, name: id, org, permissions: [], playbooks: [] };
}

function callerNow({ callers }: GoneHolderParts, run: RunInAPlaybook, id: string) {
  const playbook = playbookCallerOf(run);
  if (id === playbook.id) {
    return Effect.succeed(playbook);
  }
  return Effect.map(
    Effect.promise(() => callers.callerOf(run.org, id)),
    (caller) => caller ?? withNoGrant(run.org, id),
  );
}

function isResumedByItsShell({ resumes, calledBy }: HoldingAttempt): boolean {
  return resumes && calledBy === null;
}

function readsAgainHere({ callers }: GoneHolderParts, run: RunInAPlaybook, id: string): boolean {
  return id === playbookCallerOf(run).id || callers.readsAgain(id);
}

function hasNoNextAttempt(parts: GoneHolderParts, run: RunInAPlaybook, holding: HoldingAttempt | undefined): boolean {
  return holding !== undefined && isResumedByItsShell(holding) && !readsAgainHere(parts, run, holding.startedBy);
}

function nextAttemptRequestOf(
  run: RunInAPlaybook,
  holding: HoldingAttempt,
  caller: CallerIdentity,
  correlationId: string,
): PlaybookRequest {
  const { type, depth, callDepth, trigger, actsFor } = holding;
  return {
    caller,
    org: run.org,
    playbook: run.playbook,
    input: { type, run_id: run.runId },
    encoding: 'json',
    lineage: { causationId: null, correlationId },
    depth,
    callDepth,
    ...(trigger === null ? {} : { trigger }),
    ...(actsFor === null ? {} : { actsFor }),
    attemptDied: true,
  };
}

interface Resuming {
  readonly run: RunInAPlaybook;
  readonly holding: HoldingAttempt;
  readonly request: PlaybookRequest;
}

function resumedOrRefused({ dispatches }: GoneHolderParts, { run, holding, request }: Resuming) {
  return Effect.flatMap(dispatches.nextAttempt(request), (outcome) => {
    if (outcome.status !== 'rejected' || outcome.reason !== 'forbidden') {
      return Effect.void;
    }
    const input = { type: holding.type, run_id: run.runId, detail: outcome.detail };
    return Effect.asVoid(dispatches.refusedAttempt({ ...request, caller: playbookCallerOf(run), input }));
  });
}

function resumedNow(parts: GoneHolderParts, run: RunInAPlaybook) {
  return Effect.gen(function* () {
    const ledger = yield* Ledger;
    const address = streamAddressOf(run);
    const holding = yield* holdingAttemptIn(ledger, address);
    if (holding === undefined || !isResumedByItsShell(holding)) {
      return;
    }
    const caller = yield* callerNow(parts, run, holding.startedBy);
    const request = nextAttemptRequestOf(run, holding, caller, yield* runCorrelationIn(ledger, address));
    const leases = attemptLeasesOn(parts.store.database, parts.holding);
    const runKey = attemptKeyOfRun(run);
    yield* Effect.orDie(leases.taken(runKey));
    const resumed = resumedOrRefused(parts, { run, holding, request });
    yield* Effect.forkDetach(
      Effect.andThen(resumed, Effect.ignore(leases.released(runKey))).pipe(
        Effect.onError(() => Effect.ignore(leases.handedOver(runKey))),
      ),
    );
  });
}

export function goneHoldersOn(parts: GoneHolderParts): GoneHolders {
  const { runtime } = parts;
  return {
    holdingOf: (run) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) =>
          Effect.map(holdingAttemptIn(ledger, streamAddressOf(run)), (holding) => holding?.fencingToken),
        ),
      ),
    ended: (run, fencingToken) =>
      inRuntime(
        runtime,
        Effect.gen(function* () {
          const ledger = yield* Ledger;
          const address = streamAddressOf(run);
          const lineage = { causationId: null, correlationId: yield* runCorrelationIn(ledger, address) };
          const noNextAttempt = hasNoNextAttempt(parts, run, yield* holdingAttemptIn(ledger, address));
          const named = { run: address, lineage, fencingToken };
          return yield* deadAttemptEnder(ledger)(noNextAttempt ? { ...named, noNextAttempt } : named);
        }),
      ),
    resumed: (run) => inRuntime(runtime, resumedNow(parts, run)),
  };
}
