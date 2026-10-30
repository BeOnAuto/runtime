import { Context, Effect } from 'effect';

import { Ledger } from '../ledger/ledger.ts';
import { PlaybookRegistry } from '../ledger/playbook-registry.ts';
import { IncidentReporter } from './incident-reporter.ts';

export type DispatcherServices = Ledger | PlaybookRegistry | IncidentReporter;

export const withoutDispatcherServices = Effect.updateContext<never, never>(
  Context.omit(Ledger, PlaybookRegistry, IncidentReporter),
);
