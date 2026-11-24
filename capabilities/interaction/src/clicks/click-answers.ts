import { recordedRunIn, type RecordedRun } from '@on.auto/definitions';
import { Effect } from 'effect';

import { refusedReply, taken } from '../replies/reply-intake.ts';
import { nothingTaken } from '../replies/reply-recording.ts';
import { answerIssuesOf } from '../requests/answer-check.ts';
import { answerSoFar, settingsOf } from './answer-parts.ts';
import { redrawn } from './click-drawing.ts';
import { intakeOf, replyOf, type Clicked, type Delivery } from './click-intake.ts';
import { setRecorded } from './click-parts.ts';

export function isOpen(run: RecordedRun | undefined): run is RecordedRun {
  return run !== undefined && run.answer === null && run.run.status === 'started';
}

function answeredBy(delivery: Delivery, { request, click }: Clicked, run: RecordedRun | undefined) {
  if (!isOpen(run)) {
    return Effect.undefined;
  }
  const answer = answerSoFar(settingsOf(run.work));
  if (answerIssuesOf(answer, request.answerSchema).length > 0) {
    return Effect.undefined;
  }
  return taken(intakeOf(delivery, request), nothingTaken, { request, reply: replyOf(request, click), answer });
}

export function settled(delivery: Delivery, clicked: Clicked) {
  const address = { ...delivery.delivered.playbook, id: clicked.request.runId };
  return Effect.gen(function* () {
    const made = yield* setRecorded(delivery, clicked);
    const run = yield* recordedRunIn(delivery.parts.ledger, address);
    const answered = yield* answeredBy(delivery, clicked, run);
    if (answered?.unrecorded === true) {
      return 'unrecorded' as const;
    }
    const finished = answered !== undefined && answered.taken > 0;
    if (made !== undefined || finished) {
      yield* redrawn(delivery, { request: clicked.request, clickId: clicked.click.id, over: finished });
    }
    return made !== undefined || finished ? ('taken' as const) : ('passed_over' as const);
  }).pipe(Effect.catchTag('unavailable', () => Effect.succeed('unrecorded' as const)));
}

export function refusedClick(delivery: Delivery, { request, click }: Clicked) {
  const refusal = { request, reply: replyOf(request, click), because: 'not_the_answerer', issues: [] } as const;
  return Effect.map(refusedReply(intakeOf(delivery, request), nothingTaken, refusal), (state) =>
    state.refused > 0 ? ('refused' as const) : ('passed_over' as const),
  );
}
