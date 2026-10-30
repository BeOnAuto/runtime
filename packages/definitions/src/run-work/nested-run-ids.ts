import { uuidV5 } from '@on.auto/operations';

const nestedRuns = '9b1f3a52-6c0d-4b8e-9f27-3e5d1c7a2b40';

export function nestedRunId(runId: string, reference: string, run: number): string {
  return uuidV5(nestedRuns, `${runId}${reference}#${run}`);
}
