import { Ledger } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aPausedGreeterAlwaysWrong } from '../read-model-testing/paused-greeter.ts';
import { registeredFromTheReadModel } from './read-model-stored.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

const outcome = Effect.match(registeredFromTheReadModel('echo', 'greeter'), {
  onFailure: ({ because }: { readonly because: string }) => because,
  onSuccess: () => 'answered',
});

const versionOutcome = versionFromTheReadModel('echo', 'greeter', 1).pipe(
  Effect.as('answered'),
  Effect.catchTag('not_found', () => Effect.succeed('not_found')),
  Effect.catchTag('read_model_refused', ({ because }: { readonly because: string }) => Effect.succeed(because)),
);

function dyingWith(ledger: MemoryLedger, defect: unknown): MemoryLedger {
  return { ...ledger, service: Ledger.of({ ...ledger.service, readProjectedRows: () => Effect.die(defect) }) };
}

describe('a row of the read model that names no save of its version', () => {
  it('is refused, every time it is read, so the read falls back to the facts', async () => {
    const ledger = await aPausedGreeterAlwaysWrong();

    expect(await inThePlaybook(ledger, Effect.all([outcome, outcome, versionOutcome]))).toEqual([
      'pointer_disagrees',
      'pointer_disagrees',
      'pointer_disagrees',
    ]);
  });

  it('passes over a row that lies under no definition, as no row of the read model does', async () => {
    const ledger = await aPausedGreeterAlwaysWrong();
    const underNoDefinition = {
      ...ledger,
      service: Ledger.of({
        ...ledger.service,
        readProjectedRows: (projection, address, query) =>
          Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
            rows.map(({ definition: _definition, ...row }) => row),
          ),
      }),
    };
    expect(
      await inThePlaybook(
        underNoDefinition,
        Effect.all([registeredFromTheReadModel('echo', 'greeter'), versionOutcome]),
      ),
    ).toEqual([undefined, 'not_found']);
  });

  it('leaves any defect of the ledger a defect', async () => {
    const ledger = await aPausedGreeterAlwaysWrong();

    await expect(inThePlaybook(dyingWith(ledger, new RangeError('The disk failed')), outcome)).rejects.toThrow(
      'The disk failed',
    );
  });
});
