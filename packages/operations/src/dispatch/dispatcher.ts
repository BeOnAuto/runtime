import { Effect } from 'effect';

import {
  authorizePlaybookCall,
  authorizeOrgCall,
  confirmPlaybookTakesCall,
  confirmOrgExists,
} from '../authorization/authorization.ts';
import type { Registration, Runnable } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import type { Outcome, Rejected, Succeeded } from '../outcome/outcome.ts';
import { withoutDispatcherServices, type DispatcherServices } from './dispatcher-services.ts';
import { withinOperation } from './operation-span.ts';
import { runInOrg } from './org-binding.ts';
import { runInPlaybook } from './playbook-binding.ts';
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
  dispatchToOrg(
    registration: Runnable<'org'>,
    request: OrgRequest,
  ): Effect.Effect<Outcome<Succeeded>, never, DispatcherServices>;
  dispatchToPlaybook(
    registration: Registration<'playbook'>,
    request: PlaybookRequest,
  ): Effect.Effect<Outcome, never, DispatcherServices>;
  dispatchToPlaybook(
    registration: Runnable<'playbook'>,
    request: PlaybookRequest,
  ): Effect.Effect<Outcome<Succeeded>, never, DispatcherServices>;
}

export function makeDispatcher(steps: readonly PipelineStep[]): Dispatcher {
  const passSteps = (registration: Runnable, request: OrgRequest | PlaybookRequest) =>
    Effect.forEach(steps, (step) => step(registration, request), { discard: true });
  return {
    dispatchToOrg: <A extends Succeeded>(registration: Runnable<'org', A>, request: OrgRequest) =>
      withinOperation(
        registration,
        request,
        Effect.gen(function* () {
          yield* authorizeOrgCall(registration, request);
          yield* confirmOrgExists(request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInOrg(registration, request, ledger).pipe(withoutDispatcherServices);
        }),
      ),
    dispatchToPlaybook: <A extends Succeeded>(registration: Runnable<'playbook', A>, request: PlaybookRequest) =>
      withinOperation(
        registration,
        request,
        Effect.gen(function* () {
          yield* authorizePlaybookCall(registration, request);
          const status = yield* confirmPlaybookTakesCall(registration, request);
          yield* passSteps(registration, request);
          const ledger = yield* Ledger;
          return yield* runInPlaybook(registration, request, { ledger, lifecycle: { status } }).pipe(
            withoutDispatcherServices,
          );
        }),
      ),
  };
}
