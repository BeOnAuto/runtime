import { Effect } from 'effect';

import { admittedOrgCall, admittedPlaybookCall, type DispatcherOptions } from '../authorization/admitted-calls.ts';
import type { Registration, Runnable } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import type { Outcome, Rejected, Succeeded } from '../outcome/outcome.ts';
import { permittedAsDecidedBy, withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withinOperation } from './operation-span.ts';
import { runInOrg } from './org-binding.ts';
import { playbookBindingOf, runInPlaybook } from './playbook-binding.ts';
import type { PlaybookRequest, OrgRequest } from './request.ts';

export type PipelineStep = (
  registration: Runnable,
  request: OrgRequest | PlaybookRequest,
) => Effect.Effect<void, Rejected>;

export interface Dispatcher {
  dispatchToOrg(
    registration: Registration<'org'>,
    request: OrgRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToOrg(registration: Runnable<'org'>, request: OrgRequest): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToPlaybook(
    registration: Registration<'playbook'>,
    request: PlaybookRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToPlaybook(
    registration: Runnable<'playbook'>,
    request: PlaybookRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
}

export function makeDispatcher(steps: readonly PipelineStep[], options: DispatcherOptions = {}): Dispatcher {
  const passSteps = (registration: Runnable, request: OrgRequest | PlaybookRequest) =>
    Effect.forEach(steps, (step) => step(registration, request), { discard: true });
  return {
    dispatchToOrg: <A extends Succeeded>(registration: Runnable<'org', A>, request: OrgRequest) =>
      withinOperation(
        registration,
        request,
        Effect.gen(function* () {
          yield* admittedOrgCall(options, registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInOrg(registration, request, ledger).pipe(
            withoutDispatcherServices,
            permittedAsDecidedBy(options.decidedBy),
          );
        }),
      ),
    dispatchToPlaybook: <A extends Succeeded>(registration: Runnable<'playbook', A>, request: PlaybookRequest) =>
      withinOperation(
        registration,
        request,
        Effect.gen(function* () {
          const status = yield* admittedPlaybookCall(options, registration, request);
          yield* passSteps(registration, request);
          const bound = yield* playbookBindingOf({ options, registration, request }, status);
          return yield* runInPlaybook(registration, request, bound).pipe(
            withoutDispatcherServices,
            permittedAsDecidedBy(options.decidedBy),
          );
        }),
      ),
  };
}
