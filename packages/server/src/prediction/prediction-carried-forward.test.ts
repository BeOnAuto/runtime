import { ledgerLayout, ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { databaseDumpOf } from '../testing/records/database-floor.ts';
import { aPredictionFunctionAtTheFloor } from '../testing/records/prediction-at-the-floor.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';
import { publishedVisits, savedVisits, visitsToday } from './published-visits.ts';

function aLedgerOfTheTest(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

function served(ledger: TemporaryLedger): Promise<ReasoningServer> {
  return servingReasoning([], { SECRETS_KEY: secretsKey }, undefined, { ledger });
}

function stoppedOnce({ stop }: ReasoningServer): () => Promise<void> {
  let stopped: Promise<void> | undefined;
  return () => {
    stopped ??= stop();
    return stopped;
  };
}

describe('a ledger of the floor that holds a prediction function, its events and a dataset an earlier release folded', () => {
  it('is carried forward to the layout kept, folds the dataset again from the events and answers a question with the forecaster', async () => {
    const [made, carried] = [aLedgerOfTheTest(), aLedgerOfTheTest()];
    const visits = visitsToday();
    const making = await served(made);
    await making.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await savedVisits(making);
    await publishedVisits(making, visits, { north: 8 });
    await making.stop();
    aPredictionFunctionAtTheFloor(made.fileName, carried.fileName);
    const atTheFloor = databaseDumpOf(carried.fileName).layout;

    const server = await served(carried);
    const stopped = stoppedOnce(server);
    onTestFinished(stopped);
    await until(async () => {
      const { body } = await server.call('GET', `${alpha}/definitions/prediction/daily-visits`);
      expect(body).toMatchObject({ standing: { dataset: { phase: 'live', events_folded: 8 } } });
    });
    const answer = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
      body: { input: { series: 'north' } },
    });
    await stopped();

    expect([atTheFloor, databaseDumpOf(carried.fileName).layout]).toEqual([ledgerLayoutFloor, ledgerLayout]);
    expect(answer).toMatchObject({
      status: 200,
      body: {
        status: 'succeeded',
        record: {
          method: 'persistence',
          history: { periods: 8, first_period: visits.dayOf(8), last_period: visits.dayOf(1), origins: 6 },
        },
      },
    });
  });
});
