import { streamPrefixOfDefinition } from '@on.auto/operations';

export interface FiledRun {
  readonly org: string;
  readonly definition: string;
  readonly runId: string;
}

export interface RunInAPlaybook {
  readonly org: string;
  readonly playbook: string;
  readonly runId: string;
}

export interface RunAddress extends FiledRun, RunInAPlaybook {}

export function runKeyOf({ org, definition, runId }: FiledRun): string {
  return `${org}/${definition}/${runId}`;
}

export function addressOfRun(runKey: string): FiledRun {
  const afterOrg = runKey.indexOf('/') + 1;
  const afterDefinition = runKey.indexOf('/', afterOrg) + 1;
  return {
    org: runKey.slice(0, afterOrg - 1),
    definition: runKey.slice(afterOrg, afterDefinition - 1),
    runId: runKey.slice(afterDefinition),
  };
}

export function definitionKeyOfRun(runKey: string): string {
  return streamPrefixOfDefinition(addressOfRun(runKey));
}

export function runLogStreamOf(runKey: string): string {
  return `${definitionKeyOfRun(runKey)}run-logs/${addressOfRun(runKey).runId}`;
}

export function runKeyUnder(key: string, runId: string): string {
  const [, org = '', definition = ''] = key.split('/');
  return runKeyOf({ org, definition, runId });
}

export function runKeyOfItsLog(stream: string): string {
  return runKeyUnder(stream, stream.slice(stream.lastIndexOf('/') + 1));
}
