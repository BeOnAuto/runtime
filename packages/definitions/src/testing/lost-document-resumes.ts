import { mostInlinePayloadBytes, PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from './callers.ts';
import { resumer } from './capabilities/resumer.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';
import { twoHoursLater } from './kept-documents.ts';
import { watchedStore } from './kept-payloads.ts';
import { acted, startOfTheStep, stream } from './resumed-runs.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const longerThanAFactHolds = 'step '.repeat(mostInlinePayloadBytes / 4);

async function leftWithItsDocumentKept() {
  const watched = watchedStore();
  const resuming = resumer();
  const operations = definitionOperationsFor([resuming.capability]);
  const definitions = harness(undefined, watched.store);
  const defined = definitions.dispatch(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'resumer', name: 'step', source: longerThanAFactHolds }),
  );
  await definitions.run(defined.pipe(Effect.provideService(PayloadOffloading, true)));
  await definitions.run(Effect.orDie(definitions.ledger.service.execute(stream, runDecider, startOfTheStep)));
  const asked = { type: 'resumer', name: 'step', input: {}, run_id: acted.runId };
  const asking = (attemptDied?: true) =>
    definitions.dispatch(operations.runDefinition, {
      ...toAlpha(acmeAdmin, asked),
      ...(attemptDied === undefined ? {} : { attemptDied }),
    });
  const running = (attemptDied?: true) => definitions.run(asking(attemptDied), twoHoursLater);
  const cancelled = () =>
    definitions.call(operations.cancelRun, toAlpha(acmeAdmin, { run_id: acted.runId }), twoHoursLater);
  return { ...definitions, resuming, watched, asking, running, cancelled };
}

export async function leftWithItsDocumentLost() {
  const left = await leftWithItsDocumentKept();
  left.watched.lose();
  return left;
}

export async function leftWithItsDocumentUnread() {
  const left = await leftWithItsDocumentKept();
  left.watched.fail();
  return left;
}
