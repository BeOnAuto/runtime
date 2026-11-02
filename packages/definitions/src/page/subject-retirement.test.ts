import { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookWithTheWorkflow } from '../testing/page-playbooks.ts';
import { pageOperations } from '../testing/page-ports.ts';
import { pageOf } from '../testing/pages.ts';

function heldBeforeRecordingAPage(
  ledger: Ledger['Service'],
  reached: () => void,
  released: Promise<void>,
): Ledger['Service'] {
  return Ledger.of({
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      stream.endsWith('definitions/page')
        ? Effect.andThen(
            Effect.promise(() => {
              reached();
              return released;
            }),
            ledger.execute(stream, decider, command, lineage),
          )
        : ledger.execute(stream, decider, command, lineage),
  });
}

describe('a page saved while its subject is retired', () => {
  it('is retired when its subject is retired between the check of its subject and its record, so no active page outlives its subject', async () => {
    const { playbook, asked, reading, ready } = playbookWithTheWorkflow();
    await ready;
    const recording = Promise.withResolvers<void>();
    const retirement = Promise.withResolvers<void>();
    const save = playbook.dispatch(
      pageOperations.createDefinition,
      asked({ type: 'page', name: 'morning-posts', source: pageOf() }),
    );
    const retire = Effect.promise(() => recording.promise).pipe(
      Effect.andThen(
        playbook.dispatch(pageOperations.retireDefinition, asked({ type: 'workflow', name: 'morning-social-content' })),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          retirement.resolve();
        }),
      ),
    );

    const [saved, retired] = await playbook.run(
      Effect.provideService(
        Effect.all([save, retire], { concurrency: 'unbounded' }),
        Ledger,
        heldBeforeRecordingAPage(playbook.ledger.service, recording.resolve, retirement.promise),
      ),
    );

    expect(retired).toMatchObject({ status: 'succeeded', output: { status: 'retired' } });
    expect(saved).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
      detail:
        'The workflow morning-social-content was retired while the page morning-posts was saved, so the page is retired with it; a page presents what the playbook has',
    });
    expect(await reading({ type: 'page', name: 'morning-posts' })).toMatchObject({
      status: 'succeeded',
      output: { status: 'retired', version: 1 },
    });
  });
});
