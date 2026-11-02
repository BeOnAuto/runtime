import { Conflict, type StartingTrigger, type Unavailable } from '@on.auto/operations';
import { Context, Effect, Option } from 'effect';

export interface MeteredRun {
  readonly org: string;
  readonly playbook: string;
  readonly run_id: string;
  readonly definition_type: string;
  readonly definition_name: string;
  readonly definition_version: number;
  readonly correlation_id: string;
  readonly called_by: string | null;
  readonly trigger: StartingTrigger | null;
  readonly started_by: string;
}

export interface MeteredAgentAction {
  readonly org: string;
  readonly playbook: string;
  readonly run_id: string;
  readonly definition_type: string;
  readonly definition_name: string;
  readonly correlation_id: string;
  readonly called_by: null;
  readonly trigger: null;
  readonly started_by: string;
  readonly agent_action: true;
}

export type MeteredAction = MeteredRun | MeteredAgentAction;

export function isAgentAction(action: MeteredAction): action is MeteredAgentAction {
  return 'agent_action' in action;
}

export interface AgentActionAsked {
  readonly org: string;
  readonly playbook: string;
  readonly type: string;
  readonly operation: string;
  readonly id: string;
  readonly by: string;
}

export function agentActionOf({ org, playbook, type, operation, id, by }: AgentActionAsked): MeteredAgentAction {
  const actionId = `${operation}:${id}`;
  return {
    org,
    playbook,
    run_id: actionId,
    definition_type: type,
    definition_name: operation,
    correlation_id: actionId,
    called_by: null,
    trigger: null,
    started_by: by,
    agent_action: true,
  };
}

export interface Meter {
  readonly admit: (action: MeteredAction) => Effect.Effect<void, Conflict | Unavailable>;
}

export class RunMeter extends Context.Service<RunMeter, Meter>()('@on.auto/definitions/RunMeter') {}

const unmetered = new Conflict({
  detail: 'This runtime is missing its usage meter and cannot start runs. Reinstall the official Auto Runtime package.',
});

export const admittedByTheMeter = Effect.fnUntraced(function* (action: MeteredAction) {
  const meter = yield* Effect.serviceOption(RunMeter);
  return yield* Option.isNone(meter) ? unmetered : meter.value.admit(action);
});
