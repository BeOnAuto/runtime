import type { AccountRefusal } from '../accounts/account-failure.ts';

interface CreditRefusal {
  readonly because?: string;
  readonly resolve_at?: string;
}

interface ClosedAccount extends CreditRefusal {
  readonly detail: string;
}

interface TermsRefusal {
  readonly detail?: string;
  readonly resolve_at?: string;
}

export interface AccountRefusals {
  readonly exhaust: (refusal?: CreditRefusal) => void;
  readonly close: (closed: ClosedAccount) => void;
  readonly requireTerms: (refusal?: TermsRefusal) => void;
  readonly acceptTerms: () => void;
}

interface Refusing {
  readonly changed: (change: {
    readonly refusing?: AccountRefusal | undefined;
    readonly terms?: AccountRefusal | undefined;
  }) => void;
}

export function accountRefusals({ changed }: Refusing): AccountRefusals {
  return {
    exhaust: (refusal = {}) => {
      changed({
        refusing: { status: 409, kind: 'credits_exhausted', detail: 'The org acme has no credits left', ...refusal },
      });
    },
    close: (closed) => {
      changed({ refusing: { status: 409, kind: 'account_closed', ...closed } });
    },
    requireTerms: (refusal = {}) => {
      changed({
        terms: {
          status: 409,
          kind: 'terms_required',
          detail: 'An owner of the org acme has not accepted the activation terms 2026-10-28-draft.1',
          ...refusal,
        },
      });
    },
    acceptTerms: () => {
      changed({ terms: undefined });
    },
  };
}
