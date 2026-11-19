import { Ledger } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aPausedGreeterAlwaysWrong } from '../read-model-testing/paused-greeter.ts';
import { aTargetReadByAUser, underNoDefinition, withNoRowOfADefinition } from '../read-model-testing/read-users.ts';
import { referencesTo } from './read-model-references.ts';
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
    const ledger = underNoDefinition(await aPausedGreeterAlwaysWrong());

    expect(
      await inThePlaybook(ledger, Effect.all([registeredFromTheReadModel('echo', 'greeter'), versionOutcome])),
    ).toEqual([undefined, 'not_found']);
  });

  it('leaves any defect of the ledger a defect', async () => {
    const ledger = await aPausedGreeterAlwaysWrong();

    await expect(inThePlaybook(dyingWith(ledger, new RangeError('The disk failed')), outcome)).rejects.toThrow(
      'The disk failed',
    );
  });
});

const usersOfTheTarget = Effect.match(referencesTo('echo', 'target'), {
  onFailure: ({ because }: { readonly because: string }) => because,
  onSuccess: (references) => references.map(({ user_name: name }) => name),
});

describe('a use of a definition in the read model', () => {
  it('is answered with the name its user holds now, and passed over when it lies under no definition', async () => {
    const ledger = await aTargetReadByAUser();

    expect([
      await inThePlaybook(ledger, usersOfTheTarget),
      await inThePlaybook(underNoDefinition(ledger), usersOfTheTarget),
    ]).toEqual([['user'], []]);
  });

  it('is refused when its user has no row of its own, which every user has', async () => {
    const ledger = withNoRowOfADefinition(await aTargetReadByAUser());

    expect(await inThePlaybook(ledger, usersOfTheTarget)).toEqual('pointer_disagrees');
  });
});
