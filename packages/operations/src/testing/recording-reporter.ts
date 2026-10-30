import { Effect, Layer } from 'effect';

import { IncidentReporter, type Incident } from '../index.ts';

export type ReportedIncident = Incident;

export interface RecordingReporter {
  readonly layer: Layer.Layer<IncidentReporter>;
  readonly reported: () => readonly ReportedIncident[];
}

export function recordingReporter(): RecordingReporter {
  const reported: ReportedIncident[] = [];
  return {
    layer: Layer.succeed(
      IncidentReporter,
      IncidentReporter.of({
        report: (incident) =>
          Effect.sync(() => {
            reported.push(incident);
          }),
      }),
    ),
    reported: () => reported,
  };
}
