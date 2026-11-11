import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logHostNote } from './host-notes.ts';

describe('the notes of a playbook held at a record', () => {
  const hold = {
    org: 'acme',
    playbook: 'alpha',
    heldSince: 1_790_845_200_000,
    heldMs: 300_000,
    holds: 12,
  };

  it('warn at each try, saying what it is held for, with its tries, its next try, the record and the lag behind it', async () => {
    const tried = {
      ...hold,
      kind: 'content_hold',
      heldUntil: 1_790_845_560_000,
      recordId: 'r-1',
      type: 'run_succeeded',
      lag: 100,
      lagCapped: true,
    } as const;
    const lines = [
      ...(await linesLoggedBy(logHostNote({ ...tried, heldFor: 'content' }))),
      ...(await linesLoggedBy(logHostNote({ ...tried, heldFor: 'unreadable' }))),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '"message":"The triggers and waiting runs of a playbook are held at a record, since its content, kept outside, could not be read just now; they are tried again at held_until, and nothing behind the record is passed over. held_ms counts from the start of the playbook\'s hold, at this record or at an earlier one it was held at with no lift between; holds counts the tries at this record","level":"WARN"',
      ),
      expect.stringContaining('since this release cannot read it; they are tried again at held_until'),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","held_for":"content","held_since":"2026-10-01T09:00:00.000Z","held_ms":300000,"holds":12,"held_until":"2026-10-01T09:06:00.000Z","record_id":"r-1","type":"run_succeeded","lag":100,"lag_capped":true}',
    );
  });
});

describe('the notes of a hold lifted, or of a record this release cannot read', () => {
  const hold = {
    org: 'acme',
    playbook: 'alpha',
    heldSince: 1_790_845_200_000,
    heldMs: 300_000,
    holds: 12,
  };

  it('warn at a try that failed before it reached the record, saying when it is tried again', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({ ...hold, kind: 'content_hold_try_failed', heldFor: 'content', retryAt: 1_790_845_260_000 }),
    );

    expect(line).toContain(
      '"message":"A try of the hold of the triggers and waiting runs of a playbook failed before it reached the record it is held at; it is tried again within a minute","level":"WARN"',
    );
    expect(line).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","held_for":"content","held_since":"2026-10-01T09:00:00.000Z","held_ms":300000,"holds":12,"held_until":"2026-10-01T09:01:00.000Z"}',
    );
  });

  it('say the lift, with how long the hold lasted, its tries and the records the pass that lifted it moved past', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({ ...hold, kind: 'content_hold_lifted', heldFor: 'content', records: 250, more: true }),
    );

    expect(line).toContain(
      '"message":"The hold of the triggers and waiting runs of a playbook was lifted; records counts the records the pass that lifted it moved past","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","held_for":"content","held_since":"2026-10-01T09:00:00.000Z","held_ms":300000,"holds":12,"records":250,"more_records":true}',
    );
  });

  it('is an error at a record this release cannot read, naming the record', async () => {
    const [line] = await linesLoggedBy(
      logHostNote({ kind: 'fact_unreadable', org: 'acme', playbook: 'alpha', recordId: 'r-1', type: 'run_started' }),
    );

    expect(line).toContain(
      '"message":"A record of a playbook could not be read by this release, so its triggers and waiting runs are held at it until a release that reads it runs","level":"ERROR"',
    );
    expect(line).toContain('"annotations":{"org":"acme","playbook":"alpha","record_id":"r-1","type":"run_started"}');
  });
});
