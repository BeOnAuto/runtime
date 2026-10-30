import { Effect } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { Rejected, Succeeded } from '../outcome/outcome.ts';
import { playbookServicesOf, type PlaybookBinding } from './playbook-services.ts';
import type { PlaybookRequest } from './request.ts';

export function runInPlaybook<A extends Succeeded>(
  registration: Runnable<'playbook', A>,
  request: PlaybookRequest,
  bound: PlaybookBinding,
): Effect.Effect<A, Rejected> {
  const { forQueries, forCommands } = playbookServicesOf(request, bound);
  const { input, encoding } = request;
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration.run(input, encoding).pipe(Effect.provideContext(forCommands));
}
