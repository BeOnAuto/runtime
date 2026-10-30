import { describe, expect, it } from 'vitest';

import { cronTrigger, eventTrigger, everyTrigger } from '../reaction-testing/playbook-writes.ts';
import { triggerChangesOf } from './trigger-changes.ts';

describe('the changes a version makes to the triggers of the version before', () => {
  it('keep a trigger whose filters name the same attributes in another order', () => {
    const before = eventTrigger({ type: 'com.acme.closed', data: { region: 'eu', team: 'ledger' } });
    const after = eventTrigger({ data: { team: 'ledger', region: 'eu' }, type: 'com.acme.closed' });

    expect(triggerChangesOf([before], [after])).toEqual([{ change: 'kept', trigger: after }]);
  });

  it('activate a cron schedule whose time zone changed, and keep one whose time zone did not', () => {
    const inLondon = cronTrigger('0 9 * * *', { time_zone: 'Europe/London' });
    const inNewYork = cronTrigger('0 9 * * *', { time_zone: 'America/New_York' });

    expect([triggerChangesOf([inLondon], [inNewYork]), triggerChangesOf([inLondon], [inLondon])]).toEqual([
      [{ change: 'activated', trigger: inNewYork }],
      [{ change: 'kept', trigger: inLondon }],
    ]);
  });

  it('activate a changed or added trigger, and remove a trigger the version leaves out', () => {
    const cron = cronTrigger('0 9 * * *');

    expect(
      triggerChangesOf([everyTrigger(60_000), cron], [everyTrigger(120_000), eventTrigger({ type: 'go' })]),
    ).toEqual([
      { change: 'activated', trigger: everyTrigger(120_000) },
      { change: 'activated', trigger: eventTrigger({ type: 'go' }) },
      { change: 'removed', reference: '/schedule/cron' },
    ]);
  });
});
