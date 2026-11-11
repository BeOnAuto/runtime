import { holdNotesBy } from '../holds/hold-notes.ts';
import { holdsUnreadableIn, type HoldParts } from '../holds/playbook-holds.ts';
import type { FollowerHost } from './follower-host.ts';
import { playbookOfKey, type StepParts } from './record-steps.ts';

type PassReports = Pick<StepParts, 'unreadable' | 'contentMissing' | 'passedEarly' | 'holdsUnreadable'> &
  Omit<HoldParts, 'playbooks'>;

export function passReportsOf({
  reports,
  clock,
  context,
}: Pick<FollowerHost, 'reports' | 'clock' | 'context'>): PassReports {
  return {
    unreadable: (playbookKey, { id, type }) =>
      reports.note({ kind: 'record_unreadable', ...playbookOfKey(playbookKey), recordId: id, type }),
    contentMissing: (playbookKey, { id, type }) =>
      reports.note({
        kind: 'record_content_missing',
        ...playbookOfKey(playbookKey),
        recordId: id,
        type,
        passedBy: 'reactions',
      }),
    passedEarly: (playbookKey, { stream, version }, sweeps) =>
      reports.note({
        kind: 'run_record_passed',
        run: { ...playbookOfKey(playbookKey), runId: stream.slice(stream.lastIndexOf('/') + 1) },
        version,
        sweeps,
      }),
    holdsUnreadable: holdsUnreadableIn({ context }),
    now: clock.now,
    holdNotes: holdNotesBy(reports),
  };
}
