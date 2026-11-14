import { deniedFor, type AccessDecision } from '@on.auto/operations';
import { Result } from 'effect';

export interface DescribedError {
  readonly message: string;
}

interface PolicyError {
  readonly policyId: string;
  readonly error: DescribedError;
}

type ReadAnswer =
  | { readonly type: 'failure'; readonly errors: readonly DescribedError[] }
  | {
      readonly type: 'success';
      readonly response: {
        readonly decision: AccessDecision['decision'];
        readonly diagnostics: { readonly reason: readonly string[]; readonly errors: readonly PolicyError[] };
      };
    };

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decisionOf(answer: ReadAnswer): AccessDecision {
  if (answer.type === 'failure') {
    return deniedFor(answer.errors.map(({ message }: DescribedError) => message));
  }
  const { decision, diagnostics } = answer.response;
  const errors = diagnostics.errors.map(({ policyId, error }: PolicyError) => `${policyId}: ${error.message}`);
  if (decision === 'allow' && errors.length > 0) {
    return deniedFor(errors);
  }
  return { decision, determiningPolicies: diagnostics.reason, errors };
}

export function decidedFailingClosed(ask: () => ReadAnswer): AccessDecision {
  const decided = Result.try({ try: () => decisionOf(ask()), catch: messageOf });
  return Result.isSuccess(decided) ? decided.success : deniedFor([decided.failure]);
}
