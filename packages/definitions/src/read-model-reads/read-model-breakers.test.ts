import { Ledger, StreamProjectionRefused } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { capturedLogs } from '../read-model-testing/captured-logs.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aPausedGreeterAlwaysWrong } from '../read-model-testing/paused-greeter.ts';
import { pointerDisagreesMessage } from './read-model-refused.ts';
import { registeredFromTheReadModel } from './read-model-stored.ts';

const outcome = Effect.match(registeredFromTheReadModel('echo', 'greeter'), {
  onFailure: ({ because }: { readonly because: string }) => because,
  onSuccess: () => 'answered',
});

describe('a row of the read model that still names no save of its version once the read model was built again', () => {
  it('is refused, and the read model of its playbook is reset no more for an hour, then once more after it', async () => {
    const { ledger, resets } = await aPausedGreeterAlwaysWrong();
    const logs = capturedLogs();

    const outcomes = await inThePlaybook(
      ledger,
      Effect.gen(function* () {
        const first = yield* outcome;
        const resetsAfterTheFirst = resets();
        const within = yield* outcome;
        const resetsWithin = resets();
        yield* TestClock.adjust('1 hour');
        const after = yield* outcome;
        return [first, resetsAfterTheFirst, within, resetsWithin, after, resets()];
      }).pipe(Effect.provide(TestClock.layer()), Effect.provide(Logger.layer([logs.logger]))),
    );

    expect(outcomes).toEqual(['pointer_disagrees', 1, 'pointer_disagrees', 1, 'pointer_disagrees', 2]);
    expect(logs.logged().map(({ level, message }) => [level, message])).toEqual([
      ['ERROR', pointerDisagreesMessage],
      ['ERROR', pointerDisagreesMessage],
    ]);
  });
});

function dyingWith(ledger: MemoryLedger, defect: unknown): MemoryLedger {
  return { ...ledger, service: Ledger.of({ ...ledger.service, readProjectedRows: () => Effect.die(defect) }) };
}

describe('the one reset a half-open breaker of a row naming no save admits', () => {
  it('is the only one until another hour has passed, even when that reset fails', async () => {
    const { ledger, resets } = await aPausedGreeterAlwaysWrong('beta');
    const failingResets = {
      ...ledger,
      service: Ledger.of({
        ...ledger.service,
        resetStreamProjection: (projection, address) =>
          Effect.andThen(
            ledger.service.resetStreamProjection(projection, address),
            Effect.die(new Error('The reset failed')),
          ),
      }),
    };
    const beta = { org: 'acme', playbook: 'beta' };

    const outcomes = await inThePlaybook(
      failingResets,
      Effect.gen(function* () {
        const first = yield* Effect.exit(outcome);
        const within = yield* outcome;
        yield* TestClock.adjust('1 hour');
        const trial = yield* Effect.exit(outcome);
        const afterTheTrial = yield* outcome;
        return [Exit.isFailure(first), within, Exit.isFailure(trial), afterTheTrial, resets()];
      }).pipe(Effect.provide(TestClock.layer())),
      beta,
    );

    expect(outcomes).toEqual([true, 'pointer_disagrees', true, 'pointer_disagrees', 2]);
  });
});

describe('a read of the read model whose ledger refuses its rows once their checks failed twice', () => {
  it('is refused for its failed checks, and any other defect of the ledger stays a defect', async () => {
    const { ledger } = await aPausedGreeterAlwaysWrong();

    expect(
      await inThePlaybook(
        dyingWith(ledger, new StreamProjectionRefused('definitions', 'playbook/acme/alpha')),
        outcome,
      ),
    ).toBe('checks_failed');
    await expect(inThePlaybook(dyingWith(ledger, new RangeError('The disk failed')), outcome)).rejects.toThrow(
      'The disk failed',
    );
  });
});
