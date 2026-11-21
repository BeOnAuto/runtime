import { describe, expect, it } from 'vitest';

import { admitting, authorityAnswering, cloudMetered } from '../meter-testing/cloud-metered.ts';
import { meterOnADatabaseBehaviour } from '../meter-testing/meter-behaviour.ts';
import { meterOnItsRowsBehaviour } from '../meter-testing/meter-rows-behaviour.ts';
import { sqliteLedger, tamperingOn } from '../testing/ledgers.ts';
import { runStreamOf } from '../testing/runs.ts';

const onSQLite = () => Promise.resolve(sqliteLedger());

meterOnADatabaseBehaviour('SQLite', onSQLite);

meterOnItsRowsBehaviour('SQLite', onSQLite);

describe('a meter on SQLite whose authority admits each action, as Auto’s hosting does through its account', () => {
  it('goes on asking its authority whatever happens to the history of its runs, and never stops for it', async () => {
    const asking = authorityAnswering(admitting);
    const at = sqliteLedger();
    const metered = await cloudMetered(asking, at);
    await metered.admitted('run-1');
    await metered.started('run-1');
    await tamperingOn(at).streamDeleted(runStreamOf('run-1'));

    expect(await metered.admitted('run-1')).toEqual({ kind: 'admitted', detail: '' });
    expect(await metered.admitted('run-2')).toEqual({ kind: 'admitted', detail: '' });
    expect(asking.asked()).toEqual(['acme/run-1', 'acme/run-1', 'acme/run-2']);
  });
});
