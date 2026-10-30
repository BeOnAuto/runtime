import { InvalidInput, type Issue } from '@on.auto/operations';

export interface Rejection {
  readonly detail: string;
  readonly issues: readonly Issue[];
}

export function issuesUnder(field: string, issues: readonly Issue[]): readonly Issue[] {
  return issues.map(({ detail, pointer }) => ({ detail, pointer: `/${field}${pointer}` }));
}

export function rejectionOfSource({ detail, issues }: Rejection): InvalidInput {
  return new InvalidInput({ detail, issues: issuesUnder('source', issues) });
}
