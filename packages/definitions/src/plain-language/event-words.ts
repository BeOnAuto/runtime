import { capitalized, explanationOf, plainNumber, quoted, type StartingTrigger } from '@on.auto/operations';
import { answeredInWords, failedInWords, toolInWords, type CallFailedBecause } from '@on.auto/tool-servers';

import { timeZoneOf, type ScheduleTrigger } from '../registry/definition-triggers.ts';
import type { ModelCallFailedBecause } from '../run-work/model-call-facts.ts';
import type { CancelRequestKind } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import type { DefinitionWords } from './definition-words.ts';
import { explainedRejectionOf } from './run-words.ts';

export const runFinished = 'A run finished.';

export const runBrokeDown = 'A run broke down because of a problem inside the server.';

export function attemptResumed(attempt: number): string {
  return `The run went on from its facts in attempt ${plainNumber(attempt)}, after the attempt before it stopped.`;
}

const cancelsAsked: Readonly<Record<CancelRequestKind, string>> = {
  requested: 'Someone allowed to change the playbook asked for the run to be cancelled.',
  deadline: 'The step that waited for the run ran out of time, so the run is being cancelled.',
  parent_ended: 'The run that waited for this run ended first, so this run is being cancelled.',
};

export function cancelAsked(kind: CancelRequestKind): string {
  return cancelsAsked[kind];
}

export function requestAnswered(byAReply: boolean): string {
  return byAReply
    ? 'A reply from the party answered the request, and the run takes the answer.'
    : 'The request was answered, and the run takes the answer.';
}

const triggerNames: Readonly<Record<StartingTrigger['kind'], string>> = {
  event: 'event trigger',
  cron: 'cron schedule',
  every: 'every schedule',
};

export function triggerNamed(kind: StartingTrigger['kind']): string {
  return triggerNames[kind];
}

export function scheduleNamed(schedule: ScheduleTrigger): string {
  return schedule.kind === 'cron'
    ? `${triggerNamed(schedule.kind)} in ${timeZoneOf(schedule)}`
    : triggerNamed(schedule.kind);
}

export function runStarted(words: DefinitionWords, type: string, name: string, trigger?: StartingTrigger): string {
  return trigger === undefined
    ? `A run of ${words.named(type, name)} started.`
    : `A run of ${words.named(type, name)} was started by its ${triggerNamed(trigger.kind)}.`;
}

export function runRejected(rejection: RunRejection): string {
  return `A run did not go through: ${explanationOf(explainedRejectionOf(rejection)).why}.`;
}

export function definitionCreated(words: DefinitionWords, type: string, name: string): string {
  return `${capitalized(words.named(type, name))} was created.`;
}

export function definitionUpdated(words: DefinitionWords, type: string, name: string, version: number): string {
  return `${capitalized(words.named(type, name))} was updated to version ${plainNumber(version)}.`;
}

export function definitionRetired(words: DefinitionWords, type: string, name: string): string {
  return `${capitalized(words.named(type, name))} was retired.`;
}

export function toolCalled(number: number, server: string, tool: string): string {
  return `A run made tool call ${plainNumber(number)}, to ${toolInWords({ server, tool })}.`;
}

export function toolAnswered(number: number, isError: boolean): string {
  return `Tool call ${plainNumber(number)} ${answeredInWords(isError)}.`;
}

export function toolFailed(number: number, because: CallFailedBecause): string {
  return `Tool call ${plainNumber(number)} ${failedInWords[because]}.`;
}

function counted(count: number, one: string, many: string): string {
  return `${plainNumber(count)} ${count === 1 ? one : many}`;
}

export function modelCalled(number: number, toolsOffered: number): string {
  const offering = toolsOffered === 0 ? 'with no tools offered' : `offering ${counted(toolsOffered, 'tool', 'tools')}`;
  return `A run made model call ${plainNumber(number)}, ${offering}.`;
}

export function modelAnswered(number: number, toolCalls: number): string {
  return toolCalls === 0
    ? `Model call ${plainNumber(number)} was answered.`
    : `Model call ${plainNumber(number)} was answered, asking for ${counted(toolCalls, 'tool call', 'tool calls')}.`;
}

const modelFailures: Readonly<Record<ModelCallFailedBecause, string>> = {
  cancelled: 'was cancelled',
  content_refused: 'was refused by the provider under its content policy',
  credentials_rejected: 'was refused by the provider, which did not take the credentials of this server',
  definition_invalid: 'was refused by the provider, which did not take the request as written',
  interrupted: 'was not answered before the attempt that made it ended, so it is made again',
  model_not_allowed: 'was not made, since its model is not one this server offers',
  output_invalid: 'was answered with an answer that does not match the output the definition asks for',
  provider_not_configured: 'was not made, since its provider is not set up on this server',
  provider_unavailable: 'failed at the provider',
  rate_limited: 'was refused by the provider, which asked to slow down',
  request_too_long: 'was refused by the provider as longer than the model takes',
  timed_out: 'took too long, so it was given up',
};

export function modelFailed(number: number, because: ModelCallFailedBecause): string {
  return `Model call ${plainNumber(number)} ${modelFailures[because]}.`;
}

export function eventPublished(type: string): string {
  return `The event ${quoted(type)} was published to the playbook.`;
}

export function eventEmitted(type: string, workflow: string): string {
  return `The workflow ${quoted(workflow)} emitted the event ${quoted(type)}.`;
}

export function reactionsRefused(workflow: string): string {
  return `The workflow ${quoted(workflow)} was not started every time its triggers called for it in a minute; the details say how often and why.`;
}
