import type { Meter } from '@on.auto/definitions';
import { Conflict, Unavailable, type ConflictKind, type UnavailableKind } from '@on.auto/operations';
import { Effect } from 'effect';

interface Refusing {
  readonly detail: string;
  readonly because?: 'free_daily_limit' | 'free_month_used';
  readonly resolve_at?: string;
}

export type MeterRefusal =
  | (Refusing & {
      readonly kind: Extract<
        ConflictKind,
        'credits_exhausted' | 'license_required' | 'license_invalid' | 'account_closed'
      >;
    })
  | (Refusing & { readonly kind: Extract<UnavailableKind, 'meter_unavailable'> });

export interface RefusingMeter {
  readonly meter: Meter;
  readonly refuse: (refusal: MeterRefusal) => void;
  readonly admitAgain: () => void;
  readonly admitted: () => readonly string[];
  readonly refused: () => readonly string[];
}

function refusalOf({ kind, ...said }: MeterRefusal): Conflict | Unavailable {
  return kind === 'meter_unavailable' ? new Unavailable({ ...said, kind }) : new Conflict({ ...said, kind });
}

export function refusingMeter(): RefusingMeter {
  const refusing: { refusal: MeterRefusal | undefined } = { refusal: undefined };
  const admitted: string[] = [];
  const refused: string[] = [];
  return {
    meter: {
      admit: ({ run_id: runId }) =>
        Effect.suspend(() => {
          const { refusal } = refusing;
          if (refusal === undefined) {
            admitted.push(runId);
            return Effect.void;
          }
          refused.push(runId);
          return Effect.fail(refusalOf(refusal));
        }),
    },
    refuse: (refusal) => {
      refusing.refusal = refusal;
    },
    admitAgain: () => {
      refusing.refusal = undefined;
    },
    admitted: () => [...admitted],
    refused: () => [...refused],
  };
}
