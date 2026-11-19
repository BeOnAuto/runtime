import { Effect } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import { Ledger } from '../ledger/ledger.ts';
import { PlaybookAdmission, type PlaybookAdmissions } from '../ledger/playbook-reader.ts';
import { PlaybookRegistry, type LivePlaybookStatus } from '../ledger/playbook-registry.ts';
import type { Rejected, Succeeded } from '../outcome/outcome.ts';
import { playbookAdmissionOf, type Admitting } from './playbook-admission.ts';
import { playbookServicesOf, type PlaybookBinding } from './playbook-services.ts';
import type { PlaybookRequest } from './request.ts';

interface AdmittedBinding extends PlaybookBinding {
  readonly admission: PlaybookAdmissions;
}

export function playbookBindingOf(
  admitting: Admitting,
  status: LivePlaybookStatus,
): Effect.Effect<AdmittedBinding, never, Ledger | PlaybookRegistry> {
  return Effect.gen(function* () {
    const ledger = yield* Ledger;
    const registry = yield* PlaybookRegistry;
    return { ledger, lifecycle: { status }, admission: playbookAdmissionOf({ ...admitting, ledger, registry }) };
  });
}

export function runInPlaybook<A extends Succeeded>(
  registration: Runnable<'playbook', A>,
  request: PlaybookRequest,
  bound: AdmittedBinding,
): Effect.Effect<A, Rejected> {
  const { forQueries, forCommands } = playbookServicesOf(request, bound);
  const { input, encoding } = request;
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, encoding)
        .pipe(Effect.provideContext(forCommands), Effect.provideService(PlaybookAdmission, bound.admission));
}
