import type { CancelOfALiveAttempt, CancelRun, LookAgain } from '@on.auto/definitions';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

const quietMarginMs = 1000;

const askedAgainAfterAFailureMs = 60_000;

const keptAtMostMs = 3_600_000;

interface KeptCancel extends Omit<CancelOfALiveAttempt, 'quietForMs'> {
  readonly dueAt: number;
  readonly since: number;
}

interface CancelsAgain {
  readonly lookAgain: LookAgain;
  readonly workOf: (cancel: CancelRun) => DueWork;
}

const nothingDue: readonly DueItem[] = [];

interface Kept {
  readonly due: (at: number, most: number) => readonly KeptCancel[];
  readonly soonestAfter: (after: number) => number | null;
  readonly keptAgain: (cancel: KeptCancel, dueAt: number) => void;
  readonly settled: (cancel: KeptCancel, asked: 'asked' | 'failed', now: number) => void;
  readonly since: (id: string, now: number) => number;
}

function keptCancels(): Kept {
  const kept = new Map<string, KeptCancel>();
  const keptAgain = (cancel: KeptCancel, dueAt: number) => {
    if (dueAt - cancel.since > keptAtMostMs) {
      kept.delete(cancel.run.id);
      return;
    }
    kept.set(cancel.run.id, { ...cancel, dueAt });
  };
  return {
    due: (at, most) => [...kept.values()].filter(({ dueAt }) => dueAt <= at).slice(0, most),
    soonestAfter: (after) => {
      const later = [...kept.values()].map(({ dueAt }) => dueAt).filter((dueAt) => dueAt > after);
      return later.length === 0 ? null : Math.min(...later);
    },
    keptAgain,
    settled: (cancel, asked, now) => {
      if (kept.get(cancel.run.id)?.dueAt !== cancel.dueAt) {
        return;
      }
      if (asked === 'failed') {
        keptAgain(cancel, now + askedAgainAfterAFailureMs);
        return;
      }
      kept.delete(cancel.run.id);
    },
    since: (id, now) => kept.get(id)?.since ?? now,
  };
}

export function cancelsAgainOf(now: () => number): CancelsAgain {
  const kept = keptCancels();
  const askedAgain = (cancel: CancelRun, keptCancel: KeptCancel) =>
    cancel(keptCancel.run, keptCancel.request, keptCancel.lineage).pipe(
      Effect.match({ onFailure: () => 'failed' as const, onSuccess: () => 'asked' as const }),
      Effect.flatMap((asked) =>
        Effect.sync(() => {
          kept.settled(keptCancel, asked, now());
        }),
      ),
    );
  return {
    lookAgain: ({ run, request, lineage, quietForMs }) =>
      Effect.sync(() => {
        const since = kept.since(run.id, now());
        kept.keptAgain({ run, request, lineage, dueAt: 0, since }, now() + quietForMs + quietMarginMs);
      }),
    workOf: (cancel) => ({
      name: 'cancels asked again',
      due: (at, most, callsOut) =>
        Effect.sync(() =>
          callsOut
            ? nothingDue
            : kept.due(at, most).map((keptCancel): DueItem => ({
                key: keptCancel.run.id,
                callsOut: false,
                perform: () => askedAgain(cancel, keptCancel),
              })),
        ),
      nextDueAt: (after, callsOut = false) => Effect.sync(() => (callsOut ? null : kept.soonestAfter(after))),
    }),
  };
}
