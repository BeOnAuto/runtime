import { Caller, PlaybookContext, PlaybookWriter } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallSent } from '../journal-testing/model-calls.ts';
import { runDecider } from '../runs/run-decider.ts';
import { startedRunOf } from '../runs/run-state.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { runJournal } from './run-journal.ts';

describe('a fact the ledger cannot write', () => {
  it('fails the step that writes it as a defect, never as a call another attempt took', async () => {
    const failing = Effect.gen(function* () {
      const journal = yield* runJournal(
        '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        { startId: 'start', correlationId: 'run' },
        startedRunOf(runDecider.initialState),
      );
      return yield* journal.record({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } });
    }).pipe(
      Effect.provideService(PlaybookWriter, { execute: () => Effect.die(new Error('The disk is full')) }),
      Effect.provideService(Caller, acmeAdmin),
      Effect.provideService(PlaybookContext, { org: 'acme', playbook: 'alpha' }),
    );

    const exit = await Effect.runPromiseExit(failing);

    expect([Exit.hasDies(exit), Exit.hasFails(exit)]).toEqual([true, false]);
  });
});
