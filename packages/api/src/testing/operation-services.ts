import { admittingMeter } from '@on.auto/definitions/testing';
import type { DispatcherServices } from '@on.auto/operations';
import {
  memoryLedger,
  memoryPlaybookRegistry,
  recordingReporter,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { Layer, Tracer } from 'effect';

export interface OperationServices {
  readonly layer: Layer.Layer<DispatcherServices>;
  readonly incidents: () => readonly ReportedIncident[];
}

const knownPlaybooks = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

function tracingWith(tracer: Tracer.Tracer | undefined): Layer.Layer<never> {
  return tracer === undefined ? Layer.empty : Layer.succeed(Tracer.Tracer, tracer);
}

export function operationServices(tracer: Tracer.Tracer | undefined): OperationServices {
  const recording = recordingReporter();
  return {
    layer: Layer.mergeAll(
      memoryLedger().layer,
      memoryPlaybookRegistry(knownPlaybooks),
      recording.layer,
      admittingMeter,
      tracingWith(tracer),
    ),
    incidents: recording.reported,
  };
}
