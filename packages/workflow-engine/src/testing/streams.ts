import type { RunOutput } from '../dispatch/run-output.ts';
import type { InputReceipt } from '../machine/input-receipt.ts';
import { eventBytesOf, withHistoryBytes, type PositionedEvent } from '../run-log/run-event.ts';
import { stateFormat } from '../run-log/state-format.ts';
import type { StatePatch } from '../run-log/state-patch.ts';
import { at, document, runId } from './runs.ts';

export interface Change {
  readonly receipt: InputReceipt;
  readonly patch: StatePatch;
  readonly outputs?: readonly RunOutput[];
}

const timer = '1';

const timerPath = `/timers/armed/${timer}`;

export function streamOf(changes: readonly Change[]): readonly PositionedEvent[] {
  return changes.reduce((events: readonly PositionedEvent[], { receipt, patch, outputs = [] }: Change, index) => {
    const before = events.reduce((sum, { event }: PositionedEvent) => sum + eventBytesOf(event), 0);
    const event = withHistoryBytes(
      { type: 'input_applied', format: stateFormat, receipt, steps: [], patch, outputs },
      before,
    );
    return [...events, { version: index + 1, event }];
  }, []);
}

export const exampleStream = streamOf([
  {
    receipt: { kind: 'started', key: runId, at },
    patch: [
      { op: 'replace', path: '/runId', value: runId },
      { op: 'replace', path: '/status', value: 'running' },
      { op: 'replace', path: '/workflow', value: { document, input: 1 } },
      { op: 'add', path: '/machine/values/1', value: { value: { ticket: 7 }, bytes: 12 } },
      { op: 'replace', path: '/inputs', value: 1 },
      { op: 'replace', path: '/startedAt', value: at },
      { op: 'replace', path: '/lastInputAt', value: at },
    ],
  },
  {
    receipt: { kind: 'event_received', key: 'event-1', at: at + 10, eventType: 'com.acme.tick' },
    patch: [
      {
        op: 'add',
        path: timerPath,
        value: { purpose: 'wait', reference: '/do/0', armedAt: at + 10, dueAt: at + 1000 },
      },
      { op: 'replace', path: '/timers/next', value: 2 },
      { op: 'replace', path: '/inputs', value: 2 },
      { op: 'replace', path: '/lastInputAt', value: at + 10 },
    ],
    outputs: [{ kind: 'arm_timer', runId, timerId: timer, dueAt: at + 1000, purpose: 'wait' }],
  },
  {
    receipt: { kind: 'timer_fired', key: timer, at: at + 1000 },
    patch: [
      { op: 'remove', path: timerPath },
      { op: 'replace', path: '/machine/context', value: 1 },
      { op: 'replace', path: '/inputs', value: 3 },
      { op: 'replace', path: '/lastInputAt', value: at + 1000 },
    ],
  },
]);
