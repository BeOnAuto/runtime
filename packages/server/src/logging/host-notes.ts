import type { HostNote } from '@on.auto/workflow-host';
import { Effect } from 'effect';

type NoteOf<Kind extends HostNote['kind']> = Extract<HostNote, { readonly kind: Kind }>;

function standingBy({ holder, until }: NoteOf<'standing_by'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops renewing its claim',
  ).pipe(Effect.annotateLogs({ holder, claimed_until: new Date(until).toISOString() }));
}

function tookOver({ holder }: NoteOf<'took_over'>): Effect.Effect<void> {
  return Effect.logWarning(
    'This server took over the workflows of its database, since the server that ran them stopped renewing its claim',
  ).pipe(Effect.annotateLogs({ holder }));
}

function backingOff({ run, attempts, detail }: NoteOf<'settle_backing_off'>): Effect.Effect<void> {
  return Effect.logWarning(
    `A run could not be settled in ${attempts} attempts; it is tried again once a minute until it is`,
  ).pipe(Effect.annotateLogs({ org: run.org, playbook: run.playbook, run_id: run.runId, error: detail }));
}

function settledAfterBackingOff({ run, attempts }: NoteOf<'settled_after_back_off'>): Effect.Effect<void> {
  return Effect.logWarning(`A run that could not be settled was settled at attempt ${attempts}`).pipe(
    Effect.annotateLogs({ org: run.org, playbook: run.playbook, run_id: run.runId }),
  );
}

function passedOver(note: NoteOf<'record_passed_over'>): Effect.Effect<void> {
  const { playbook, record } = note;
  return note.reason === 'unreadable'
    ? Effect.logWarning(
        'A recorded event of a playbook could not be read as an event, so neither a page nor a dataset folds it',
      ).pipe(Effect.annotateLogs({ playbook, record }))
    : Effect.logWarning(
        'A recorded event of a playbook was passed over by a projection whose filters it matched, since it holds what that projection cannot take',
      ).pipe(Effect.annotateLogs({ playbook, record, passed_over_by: note.by, detail: note.detail }));
}

function viewStalled({ playbook, name, version }: NoteOf<'view_stalled'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The views of a page stopped at an event its fold could not take; saving a corrected version rebuilds them',
  ).pipe(Effect.annotateLogs({ playbook, page: name, version }));
}

function datasetStalled({ playbook, dataSha256, record, detail }: NoteOf<'dataset_stalled'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The dataset of a prediction function stopped at an event its data test could not get through within its time and memory, and folds nothing more; a data part that changes starts a dataset of its own',
  ).pipe(Effect.annotateLogs({ playbook, data_sha256: dataSha256, record, detail }));
}

function scheduleStopped(note: NoteOf<'schedule_stopped'>): Effect.Effect<void> {
  const { org, playbook, workflow, version, reference, detail } = note;
  return Effect.logWarning(
    'The times of a schedule of a workflow cannot be computed, so it starts no more runs; a version of the workflow that changes the schedule starts it again',
  ).pipe(Effect.annotateLogs({ org, playbook, workflow, version, trigger: reference, error: detail }));
}

function offerDeclined({ run, detail }: NoteOf<'offer_declined'>): Effect.Effect<void> {
  return Effect.logWarning(
    'A run waiting for an event of its playbook did not take one, since its filter failed on the event',
  ).pipe(Effect.annotateLogs({ org: run.org, playbook: run.playbook, run_id: run.runId, error: detail }));
}

function recordUnreadable({ org, playbook, recordId, type }: NoteOf<'record_unreadable'>): Effect.Effect<void> {
  return Effect.logWarning(
    'A record of the playbook could not be read to match triggers and waiting runs against; it was passed over',
  ).pipe(Effect.annotateLogs({ org, playbook, record_id: recordId, type }));
}

function recordContentMissing({
  org,
  playbook,
  recordId,
  type,
  passedBy,
}: NoteOf<'record_content_missing'>): Effect.Effect<void> {
  const what =
    passedBy === 'reactions'
      ? 'triggers and waiting runs were not given it'
      : 'the views folded it with the output as its size';
  return Effect.logError(
    `The output a record of the playbook keeps outside is missing from its content, so ${what}`,
  ).pipe(Effect.annotateLogs({ org, playbook, record_id: recordId, type }));
}

const heldForWords = {
  content: 'its content, kept outside, could not be read just now',
  unreadable: 'this release cannot read it',
} as const;

function contentHold(note: NoteOf<'content_hold'>): Effect.Effect<void> {
  const { org, playbook, heldFor, heldSince, heldMs, holds, heldUntil, recordId, type, lag, lagCapped } = note;
  return Effect.logWarning(
    `The triggers and waiting runs of a playbook are held at a record, since ${heldForWords[heldFor]}; they are tried again at held_until, and nothing behind the record is passed over. held_ms counts from the start of the playbook's hold, at this record or at an earlier one it was held at with no lift between; holds counts the tries at this record`,
  ).pipe(
    Effect.annotateLogs({
      org,
      playbook,
      held_for: heldFor,
      held_since: new Date(heldSince).toISOString(),
      held_ms: heldMs,
      holds,
      held_until: new Date(heldUntil).toISOString(),
      record_id: recordId,
      type,
      lag,
      lag_capped: lagCapped,
    }),
  );
}

function contentHoldTryFailed(note: NoteOf<'content_hold_try_failed'>): Effect.Effect<void> {
  const { org, playbook, heldFor, heldSince, heldMs, holds, retryAt } = note;
  return Effect.logWarning(
    'A try of the hold of the triggers and waiting runs of a playbook failed before it reached the record it is held at; it is tried again within a minute',
  ).pipe(
    Effect.annotateLogs({
      org,
      playbook,
      held_for: heldFor,
      held_since: new Date(heldSince).toISOString(),
      held_ms: heldMs,
      holds,
      held_until: new Date(retryAt).toISOString(),
    }),
  );
}

function contentHoldLifted(note: NoteOf<'content_hold_lifted'>): Effect.Effect<void> {
  const { org, playbook, heldFor, heldSince, heldMs, holds, records, more } = note;
  return Effect.logInfo(
    'The hold of the triggers and waiting runs of a playbook was lifted; records counts the records the pass that lifted it moved past',
  ).pipe(
    Effect.annotateLogs({
      org,
      playbook,
      held_for: heldFor,
      held_since: new Date(heldSince).toISOString(),
      held_ms: heldMs,
      holds,
      records,
      more_records: more,
    }),
  );
}

function factUnreadable({ org, playbook, recordId, type }: NoteOf<'fact_unreadable'>): Effect.Effect<void> {
  return Effect.logError(
    'A record of a playbook could not be read by this release, so its triggers and waiting runs are held at it until a release that reads it runs',
  ).pipe(Effect.annotateLogs({ org, playbook, record_id: recordId, type }));
}

function runRecordPassed({ run, version, sweeps }: NoteOf<'run_record_passed'>): Effect.Effect<void> {
  return Effect.logWarning(
    `A record of a run's log was passed before the run's outputs were dispatched, after ${sweeps} sweeps held it; a listener it armed takes events once it is kept, and none recorded before`,
  ).pipe(Effect.annotateLogs({ org: run.org, playbook: run.playbook, run_id: run.runId, version }));
}

function runReloaded({ run, snapshot, events, keptBytes }: NoteOf<'run_reloaded'>): Effect.Effect<void> {
  return Effect.logDebug(
    'A run was loaded from the ledger again, since the runs the workflows keep in memory no longer held it',
  ).pipe(
    Effect.annotateLogs({
      org: run.org,
      playbook: run.playbook,
      run_id: run.runId,
      from_snapshot: snapshot,
      events,
      kept_bytes: keptBytes,
    }),
  );
}

function payloadsRead({ run, texts, bytes, unread }: NoteOf<'payloads_read'>): Effect.Effect<void> {
  return Effect.logDebug(
    'A run read from the content store the texts of values it keeps outside its log, to decide or to start a call',
  ).pipe(
    Effect.annotateLogs({
      org: run.org,
      playbook: run.playbook,
      run_id: run.runId,
      texts,
      bytes,
      unread,
    }),
  );
}

const loggers: { readonly [Kind in HostNote['kind']]: (note: NoteOf<Kind>) => Effect.Effect<void> } = {
  standing_by: standingBy,
  took_over: tookOver,
  settle_backing_off: backingOff,
  settled_after_back_off: settledAfterBackingOff,
  record_passed_over: passedOver,
  view_stalled: viewStalled,
  dataset_stalled: datasetStalled,
  schedule_stopped: scheduleStopped,
  offer_declined: offerDeclined,
  record_unreadable: recordUnreadable,
  record_content_missing: recordContentMissing,
  content_hold: contentHold,
  content_hold_try_failed: contentHoldTryFailed,
  content_hold_lifted: contentHoldLifted,
  fact_unreadable: factUnreadable,
  run_record_passed: runRecordPassed,
  run_reloaded: runReloaded,
  payloads_read: payloadsRead,
};

function loggedBy<Kind extends HostNote['kind']>(note: NoteOf<Kind>): Effect.Effect<void> {
  const logger: (note: NoteOf<Kind>) => Effect.Effect<void> = loggers[note.kind];
  return logger(note);
}

export function logHostNote(note: HostNote): Effect.Effect<void> {
  return loggedBy(note);
}
