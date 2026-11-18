import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { streamPrefixOfOrg } from '../ledger/bound-ports.ts';
import type { Ledger } from '../ledger/ledger.ts';
import { Conflict } from '../outcome/conflict.ts';
import type { RunIds } from '../run-ids/run-ids.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';

type AnyLedger = Ledger['Service'];

export type RunIdsLedger = (runIds: RunIds) => Promise<AnyLedger>;

const heldElsewhere = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

export const runIdsOfTheTests: RunIds = { types: ['run_began'], heldElsewhere: () => heldElsewhere };

const began: RunFact = { type: 'run_began', data: { at: '2026-11-17T09:00:00.000Z', fn: 'brief' } };

const noted: RunFact = { type: 'run_noted', data: {} };

async function appended(ledger: AnyLedger, stream: string, fact: RunFact = began): Promise<unknown> {
  const exit = await Effect.runPromiseExit(ledger.execute(stream, runFacts, [fact]));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : 'kept';
}

function factsOf(ledger: AnyLedger, stream: string): Promise<number> {
  return Effect.runPromise(Effect.map(ledger.load(stream, runFacts), ({ version }) => version));
}

function holdersBehaviour(open: RunIdsLedger): void {
  it('answer the definition whose run holds an id in an org, and none where no run of the org holds it', async () => {
    const ledger = await open(runIdsOfTheTests);
    await appended(ledger, 'definition/acme/d1/runs/r1');
    await appended(ledger, 'definition/acme/d2/runs/r1');
    await appended(ledger, 'definition/umbrella/d3/runs/r2');
    await appended(ledger, 'definition/acme/d4/runs/r3', noted);
    const holderOf = (org: string, runId: string) =>
      Effect.runPromise(ledger.holderOfRunId({ orgKey: streamPrefixOfOrg({ org }), runId }));

    expect(
      await Promise.all([
        holderOf('acme', 'r1'),
        holderOf('acme', 'r2'),
        holderOf('umbrella', 'r2'),
        holderOf('acme', 'r3'),
      ]),
    ).toEqual(['definition/acme/d1/', undefined, 'definition/umbrella/d3/', undefined]);
  });
}

export function runIdsBehaviour(open: RunIdsLedger): void {
  describe('the ids of runs', () => {
    it('keep one run under an id in an org: a run of another definition under it is refused and keeps nothing, while the same run goes on and another org may use the id', async () => {
      const ledger = await open(runIdsOfTheTests);
      const first = await appended(ledger, 'definition/acme/d1/runs/r1');

      const answers = [
        await appended(ledger, 'definition/acme/d2/runs/r1'),
        await appended(ledger, 'definition/acme/d1/runs/r1', noted),
        await appended(ledger, 'definition/umbrella/d2/runs/r1'),
        await appended(ledger, 'definition/acme/d3/runs/r1'),
      ];

      expect([first, ...answers]).toEqual(['kept', heldElsewhere, 'kept', 'kept', heldElsewhere]);
      expect([
        await factsOf(ledger, 'definition/acme/d2/runs/r1'),
        await factsOf(ledger, 'definition/acme/d1/runs/r1'),
      ]).toEqual([0, 2]);
    });

    it('are claimed by the first fact of a run alone, of the types that begin one, on a stream of a definition', async () => {
      const ledger = await open(runIdsOfTheTests);
      await appended(ledger, 'definition/acme/d1/run-logs/r1');
      await appended(ledger, 'playbook/acme/alpha/runs/r1');
      await appended(ledger, 'definition/acme/d1/notes/r1');
      await appended(ledger, 'definition/acme/d2/runs/r2', noted);

      const answers = [
        await appended(ledger, 'definition/acme/d2/runs/r1'),
        await appended(ledger, 'definition/acme/d3/runs/r2'),
        await appended(ledger, 'definition/acme/d2/runs/r2'),
      ];

      expect(answers).toEqual(['kept', 'kept', 'kept']);
    });

    holdersBehaviour(open);
  });
}
