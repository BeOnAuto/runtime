import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logHostNote } from './host-notes.ts';

const run = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

describe('the notes of the workflow host', () => {
  it('warn that another server runs the workflows of the database, and until when it holds them', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({ kind: 'standing_by', holder: 'server-a', until: 1_790_845_203_000 }),
    );

    expect(line).toContain(
      '"message":"The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops renewing its claim","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"holder":"server-a","claimed_until":"2026-10-01T09:00:03.000Z"}');
  });

  it('warn that this server took the workflows over', async () => {
    const [line] = await linesLoggedBy(logHostNote({ kind: 'took_over', holder: 'server-b' }));

    expect(line).toContain(
      '"message":"This server took over the workflows of its database, since the server that ran them stopped renewing its claim","level":"WARN"',
    );
  });

  it('warn once when a settlement backs off, and once when it is settled at last, naming only the run', async () => {
    const lines = [
      ...(await linesLoggedBy(
        logHostNote({ kind: 'settle_backing_off', run, attempts: 20, detail: 'The ledger cannot be reached' }),
      )),
      ...(await linesLoggedBy(logHostNote({ kind: 'settled_after_back_off', run, attempts: 22 }))),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '"message":"A run could not be settled in 20 attempts; it is tried again once a minute until it is","level":"WARN"',
      ),
      expect.stringContaining('"message":"A run that could not be settled was settled at attempt 22","level":"WARN"'),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","error":"The ledger cannot be reached"}',
    );
  });
});

describe('the notes of the views the workflow host keeps', () => {
  it('warn of a recorded event no recall function can fold, and of a view that stopped, naming the playbook', async () => {
    const lines = [
      ...(await linesLoggedBy(
        logHostNote({
          kind: 'record_passed_over',
          playbook: 'playbook/acme/alpha/',
          record: 'r-1',
          reason: 'unreadable',
        }),
      )),
      ...(await linesLoggedBy(
        logHostNote({ kind: 'view_stalled', playbook: 'playbook/acme/alpha/', name: 'reviews', version: 2 }),
      )),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '"message":"A recorded event of a playbook could not be read as an event, so neither a recall function nor a dataset folds it","level":"WARN"',
      ),
      expect.stringContaining(
        '"message":"The view of a recall function stopped at an event its fold could not take; saving a corrected version rebuilds it","level":"WARN"',
      ),
    ]);
    expect(lines[1]).toContain(
      '"annotations":{"playbook":"playbook/acme/alpha/","recall_function":"reviews","version":2}',
    );
  });
});

describe('the note of an event a projection passed over', () => {
  it('warns that the event matched its filters but held what it cannot take, naming the projection and why', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({
        kind: 'record_passed_over',
        playbook: 'playbook/acme/alpha/',
        record: 'r-2',
        reason: 'refused',
        by: 'the dataset 3f2a',
        detail: 'Its series at /region is not text of at most 256 bytes',
      }),
    );

    expect(line).toContain(
      '"message":"A recorded event of a playbook was passed over by a projection whose filters it matched, since it holds what that projection cannot take","level":"WARN"',
    );
    expect(line).toContain(
      '"annotations":{"playbook":"playbook/acme/alpha/","record":"r-2","passed_over_by":"the dataset 3f2a","detail":"Its series at /region is not text of at most 256 bytes"}',
    );
  });
});

describe('the note of a dataset that stalled', () => {
  it('warns that the dataset folds nothing more, naming the playbook, the dataset, the event and why', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({
        kind: 'dataset_stalled',
        playbook: 'playbook/acme/alpha/',
        dataSha256: '3f2ac1d0e4b5',
        record: 'r-3',
        detail: 'Its data test was stopped 20 times without a page folded whole, the last at this event',
      }),
    );

    expect(line).toContain(
      '"message":"The dataset of a prediction function stopped at an event its data test could not get through within its time and memory, and folds nothing more; a data part that changes starts a dataset of its own","level":"WARN"',
    );
    expect(line).toContain(
      '"annotations":{"playbook":"playbook/acme/alpha/","data_sha256":"3f2ac1d0e4b5","record":"r-3","detail":"Its data test was stopped 20 times without a page folded whole, the last at this event"}',
    );
  });
});

describe('the note of a record of a run passed before its outputs were dispatched', () => {
  it('warns that a listener the record armed takes no event recorded before it is kept', async () => {
    const [line] = await linesLoggedBy(logHostNote({ kind: 'run_record_passed', run, version: 4, sweeps: 20 }));

    expect(line).toContain(
      '"message":"A record of a run\'s log was passed before the run\'s outputs were dispatched, after 20 sweeps held it; a listener it armed takes events once it is kept, and none recorded before","level":"WARN"',
    );
    expect(line).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","version":4}',
    );
  });
});

describe('the notes of the reactions of the workflow host', () => {
  it('warn of an event a waiting run did not take because its filter failed, and of a record the triggers could not read', async () => {
    const lines = [
      ...(await linesLoggedBy(logHostNote({ kind: 'offer_declined', run, detail: 'An expression failed' }))),
      ...(await linesLoggedBy(
        logHostNote({
          kind: 'record_unreadable',
          org: 'acme',
          playbook: 'alpha',
          recordId: 'r-1',
          type: 'event_published',
        }),
      )),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '"message":"A run waiting for an event of its playbook did not take one, since its filter failed on the event","level":"WARN"',
      ),
      expect.stringContaining(
        '"message":"A record of the playbook could not be read to match triggers and waiting runs against; it was passed over","level":"WARN"',
      ),
    ]);
    expect(lines[1]).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","record_id":"r-1","type":"event_published"}',
    );
  });

  it('warn of a schedule whose times cannot be computed, naming its workflow, version and trigger', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({
        kind: 'schedule_stopped',
        org: 'acme',
        playbook: 'alpha',
        workflow: 'morning',
        version: 3,
        reference: '/schedule/cron',
        detail: 'Invalid time zone specified: America/New_York',
      }),
    );

    expect(line).toContain(
      '"message":"The times of a schedule of a workflow cannot be computed, so it starts no more runs; a version of the workflow that changes the schedule starts it again","level":"WARN"',
    );
    expect(line).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","workflow":"morning","version":3,"trigger":"/schedule/cron","error":"Invalid time zone specified: America/New_York"}',
    );
  });
});
