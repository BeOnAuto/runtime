import { streamPrefixOfPlaybook } from '@on.auto/operations';

export interface RunAddress {
  readonly org: string;
  readonly playbook: string;
  readonly runId: string;
}

export function runKeyOf({ org, playbook, runId }: RunAddress): string {
  return `${org}/${playbook}/${runId}`;
}

export function addressOfRun(runKey: string): RunAddress {
  const afterOrg = runKey.indexOf('/') + 1;
  const afterPlaybook = runKey.indexOf('/', afterOrg) + 1;
  return {
    org: runKey.slice(0, afterOrg - 1),
    playbook: runKey.slice(afterOrg, afterPlaybook - 1),
    runId: runKey.slice(afterPlaybook),
  };
}

export function runLogStreamOf(runKey: string): string {
  const address = addressOfRun(runKey);
  return `${streamPrefixOfPlaybook(address)}run-logs/${address.runId}`;
}
