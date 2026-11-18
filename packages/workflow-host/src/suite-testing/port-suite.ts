import {
  executorProbes,
  listenerProbes,
  recordStoreProbes,
  runStoreProbes,
  timerProbes,
  watermarkProbes,
  type Probe,
} from '@on.auto/workflow-engine/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { startedIn } from '../testing/started-runs.ts';
import { executorSubjectOn } from './executor-subject.ts';
import {
  listenerSubjectOn,
  otherProbeRun,
  probeRun,
  recordStoreSubjectOn,
  runStoreSubjectOn,
  timerSubjectOn,
  watermarkSubjectOn,
} from './probe-subjects.ts';

interface ProbeCase {
  readonly title: string;
  readonly expected: readonly string[];
  readonly run: (database: HostDatabase) => Effect.Effect<readonly string[], unknown>;
}

function casesOf<Subject>(
  probes: readonly Probe<Subject>[],
  subjectOn: (database: HostDatabase) => Subject,
): readonly ProbeCase[] {
  return probes.map(({ title, expected, run }) => ({ title, expected, run: (database) => run(subjectOn(database)) }));
}

interface Port {
  readonly port: string;
  readonly cases: readonly ProbeCase[];
}

const ports: readonly Port[] = [
  { port: 'timers', cases: casesOf(timerProbes, timerSubjectOn) },
  { port: 'executor', cases: casesOf(executorProbes, executorSubjectOn) },
  { port: 'record store', cases: casesOf(recordStoreProbes, recordStoreSubjectOn) },
  { port: 'dispatch watermark', cases: casesOf(watermarkProbes, watermarkSubjectOn) },
  { port: 'run store', cases: casesOf(runStoreProbes, runStoreSubjectOn) },
  { port: 'listeners', cases: casesOf(listenerProbes, listenerSubjectOn) },
];

export function portSuite(settings: SettingsOf): void {
  describe.each(ports)('its $port, which meets the contract of the engine', ({ cases }) => {
    it.each(cases)('$title', async ({ run, expected }) => {
      const database = await startedIn(await startedIn(await openedOn(await settings()), probeRun), otherProbeRun);

      expect(await Effect.runPromise(run(database))).toEqual(expected);
    });
  });
}
