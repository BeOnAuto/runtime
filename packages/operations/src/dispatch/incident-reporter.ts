import { Context, type Effect } from 'effect';

export interface CallSummary {
  readonly operation: string;
  readonly org: string;
  readonly playbook?: string;
  readonly caller: string;
}

export interface Incident {
  readonly id: string;
  readonly original: unknown;
  readonly call?: CallSummary | undefined;
}

export class IncidentReporter extends Context.Service<
  IncidentReporter,
  {
    readonly report: (incident: Incident) => Effect.Effect<void>;
  }
>()('@on.auto/operations/IncidentReporter') {}
