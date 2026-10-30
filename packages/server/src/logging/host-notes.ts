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
        'A recorded event of a playbook could not be read as an event, so neither a recall function nor a dataset folds it',
      ).pipe(Effect.annotateLogs({ playbook, record }))
    : Effect.logWarning(
        'A recorded event of a playbook was passed over by a projection whose filters it matched, since it holds what that projection cannot take',
      ).pipe(Effect.annotateLogs({ playbook, record, passed_over_by: note.by, detail: note.detail }));
}

function viewStalled({ playbook, name, version }: NoteOf<'view_stalled'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The view of a recall function stopped at an event its fold could not take; saving a corrected version rebuilds it',
  ).pipe(Effect.annotateLogs({ playbook, recall_function: name, version }));
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

function runRecordPassed({ run, version, sweeps }: NoteOf<'run_record_passed'>): Effect.Effect<void> {
  return Effect.logWarning(
    `A record of a run's log was passed before the run's outputs were dispatched, after ${sweeps} sweeps held it; a listener it armed takes events once it is kept, and none recorded before`,
  ).pipe(Effect.annotateLogs({ org: run.org, playbook: run.playbook, run_id: run.runId, version }));
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
  run_record_passed: runRecordPassed,
};

function loggedBy<Kind extends HostNote['kind']>(note: NoteOf<Kind>): Effect.Effect<void> {
  const logger: (note: NoteOf<Kind>) => Effect.Effect<void> = loggers[note.kind];
  return logger(note);
}

export function logHostNote(note: HostNote): Effect.Effect<void> {
  return loggedBy(note);
}
