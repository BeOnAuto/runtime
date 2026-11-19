import { Effect } from 'effect';

import { admittedPlaybookCall, type DispatcherOptions } from '../authorization/admitted-calls.ts';
import { otherPlaybookNotAccessible } from '../authorization/authorization.ts';
import type { Runnable } from '../definition/registration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import { playbookReaderOf } from '../ledger/playbook-ledger.ts';
import type { PlaybookAdmissions } from '../ledger/playbook-reader.ts';
import { PlaybookRegistry } from '../ledger/playbook-registry.ts';
import { typedRejectionOf } from '../outcome/typed-rejection.ts';
import type { PlaybookRequest } from './request.ts';

export interface Admitting {
  readonly options: DispatcherOptions;
  readonly registration: Runnable<'playbook'>;
  readonly request: PlaybookRequest;
}

interface AdmittingOver extends Admitting {
  readonly ledger: LedgerPorts;
  readonly registry: PlaybookRegistry['Service'];
}

export function playbookAdmissionOf({
  options,
  registration,
  request,
  ledger,
  registry,
}: AdmittingOver): PlaybookAdmissions {
  return {
    admitted: (playbook) => {
      const address = { org: request.org, playbook };
      return admittedPlaybookCall(
        options,
        registration,
        { ...request, playbook },
        otherPlaybookNotAccessible(playbook),
      ).pipe(
        Effect.provideService(PlaybookRegistry, registry),
        Effect.mapError(typedRejectionOf),
        Effect.as({ address, reader: playbookReaderOf(ledger, address) }),
      );
    },
  };
}
