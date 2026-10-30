import { Cause, Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import { startListeningLoop, type LoopParts } from '../loop/host-loop.ts';
import { oneWakeAtATime, type HostWakeUp, type WakeSignal } from '../loop/host-wake-up.ts';
import type { SomeFolder } from './folder.ts';
import { playbookKeyOfDefinitions } from './playbook-definitions.ts';
import { playbookPass, type PassParts } from './playbook-pass.ts';
import { scheduleOf, type Schedule } from './projector-schedule.ts';
import type { ProjectorSettings } from './projector-settings.ts';

export interface Projector {
  readonly stop: () => Promise<void>;
}

export interface ProjectorParts {
  readonly database: HostDatabase;
  readonly settings: ProjectorSettings;
  readonly reports: HostReports;
}

const mostRemembered = 1024;

export function firstSeenOf(most: number): (record: string) => boolean {
  const seen = new Set<string>();
  return (record) => {
    if (seen.has(record)) {
      return false;
    }
    seen.add(record);
    for (const oldest of seen.values().take(Math.max(0, seen.size - most))) {
      seen.delete(oldest);
    }
    return true;
  };
}

function discoveredFor(database: HostDatabase, schedule: Schedule, definitionType: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const streams = yield* Effect.promise(() => database.store.definitionStreams(definitionType));
    const known = schedule.definitions.of(definitionType);
    for (const { stream, version } of streams) {
      const playbook = playbookKeyOfDefinitions(stream, definitionType);
      if (known.get(playbook)?.version !== version) {
        schedule.want(playbook);
      }
    }
  });
}

function discovered({ database, settings }: ProjectorParts, schedule: Schedule): Effect.Effect<void> {
  return Effect.forEach(
    settings.folders,
    (some) =>
      discoveredFor(
        database,
        schedule,
        some((folder) => folder.definitionType),
      ),
    { discard: true },
  );
}

function playbooksWithRows(database: HostDatabase, folders: readonly SomeFolder[]) {
  return Effect.forEach(folders, (some) => some((folder) => folder.playbooksWithRows(database))).pipe(
    Effect.map((playbooks: readonly (readonly string[])[]) => new Set(playbooks.flat())),
  );
}

function swept(parts: ProjectorParts, schedule: Schedule, sweep: boolean): Effect.Effect<void> {
  return Effect.gen(function* () {
    const discoveryDue = schedule.discoveryDue();
    if (!sweep && !discoveryDue) {
      return;
    }
    yield* discovered(parts, schedule);
    if (sweep) {
      schedule.swept();
      const playbooks = yield* Effect.orDie(playbooksWithRows(parts.database, parts.settings.folders));
      for (const playbook of playbooks) {
        schedule.want(playbook);
      }
    }
  });
}

function round(parts: ProjectorParts, schedule: Schedule, passParts: PassParts): Effect.Effect<void> {
  return Effect.forEach(
    schedule.wanted(),
    (playbook) =>
      playbookPass(passParts, playbook).pipe(
        Effect.tap((more) =>
          Effect.sync(() => {
            if (more) {
              schedule.want(playbook);
            }
          }),
        ),
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          parts.reports.trouble('A pass of the views of a playbook failed; the next sweep tries again', cause),
        ),
      ),
    { concurrency: parts.settings.playbooksAtOnce, discard: true },
  );
}

function passPartsOf({ database, settings, reports }: ProjectorParts, schedule: Schedule): PassParts {
  return {
    database,
    settings,
    definitions: schedule.definitions.of,
    note: reports.note,
    resting: schedule.resting,
    firstSeen: firstSeenOf(mostRemembered),
    trouble: (what) => reports.trouble(what, Cause.fail(what)),
  };
}

export function projectorWakeUp(parts: ProjectorParts, signal: WakeSignal): HostWakeUp {
  const schedule = scheduleOf();
  const passParts = passPartsOf(parts, schedule);
  const stopListening = parts.settings.appends?.listen((playbook) => {
    if (schedule.definitions.knows(playbook)) {
      schedule.want(playbook);
    } else {
      schedule.discover();
    }
    signal.raised();
  });
  return {
    wakeUp: oneWakeAtATime(({ now, sweep }) =>
      Effect.andThen(
        swept(parts, schedule, sweep),
        Effect.suspend(() => round(parts, schedule, passParts)),
      ).pipe(
        Effect.catchCause((cause) =>
          parts.reports.trouble('A sweep of the views failed; the next sweep tries again', cause),
        ),
        Effect.andThen(
          Effect.sync(() => {
            signal.renewed();
            return { nextDueAt: schedule.idle() ? null : now };
          }),
        ),
      ),
    ),
    stop: () =>
      Effect.sync(() => {
        stopListening?.();
      }),
  };
}

export function startProjector(parts: ProjectorParts & LoopParts): Projector {
  return startListeningLoop(parts, (signal) => projectorWakeUp(parts, signal));
}
