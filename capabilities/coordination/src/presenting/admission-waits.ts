import { isRecordedStep, RunLogEventSchema, type Step } from '@on.auto/workflow-engine';
import { Schema } from 'effect';

export type StepRefusal = NonNullable<Step['refusal']>;

interface StepOfTheRun {
  readonly step: string;
  readonly run: number;
}

interface WaitingForAdmission extends StepOfTheRun {
  readonly waiting: true;
  readonly refusal: StepRefusal;
}

interface NoLongerWaiting extends StepOfTheRun {
  readonly waiting: false;
}

export type AdmissionWait = WaitingForAdmission | NoLongerWaiting;

const decodeRunLogEvent = Schema.decodeUnknownSync(Schema.toCodecJson(RunLogEventSchema));

function waitOf({ reference, run, outcome, waits_for: waitsFor, refusal }: Step): readonly AdmissionWait[] {
  const step = reference.slice(1);
  if (outcome !== 'waiting') {
    return [{ step, run, waiting: false }];
  }
  return waitsFor === 'admission' && refusal !== undefined ? [{ step, run, waiting: true, refusal }] : [];
}

export function admissionWaitsOf(recorded: unknown): readonly AdmissionWait[] {
  return decodeRunLogEvent(recorded)
    .steps.filter((step) => isRecordedStep(step))
    .flatMap((step) => waitOf(step));
}
