import { keptArmOf, keptIn, recordedAsGiven } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { askedRunId, askedThroughChat } from '../testing/index.ts';
import { answerInteraction } from './answer-interaction.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const answer = { choice: 'approve', notes: 'n'.repeat(4096) };

describe('the answer to a request that its playbook keeps outside the run', () => {
  it('is answered again as it was taken, in the words the caller gave, which are its text, with no read', async () => {
    const { playbook, askedAt } = await askedThroughChat();
    const kept = keptArmOf(answer);
    const context = {
      runId: askedRunId,
      by: 'acme-admin',
      at: new Date(askedAt).toISOString(),
      definitionType: 'interaction',
      definitionName: 'approve-brief',
      definitionVersion: 1,
    };
    const data = {
      answer_sha256: kept.sha256,
      answer_bytes: kept.bytes,
      answered_by: { id: 'acme-admin', name: 'acme-admin' },
    };
    await Effect.runPromise(
      Effect.andThen(
        keptIn(playbook.ledger.service.content, alpha, answer),
        recordedAsGiven(
          playbook.ledger.service,
          `playbook/acme/alpha/runs/${askedRunId}`,
          [{ type: 'request_answered', data }],
          context,
        ),
      ),
    );

    expect(await playbook.call(answerInteraction, { run_id: askedRunId, answer })).toMatchObject({
      status: 'succeeded',
      output: { run_id: askedRunId, answer },
    });
  });
});
