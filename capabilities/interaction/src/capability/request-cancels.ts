import { cancelledAsAsked, type CancelledRun, type Settlement } from '@on.auto/definitions';

import { interactionWorkOf } from '../facts/work-rules.ts';
import { requestRecordOf, takesAnswer } from '../run/request-record.ts';
import { answeredSettlement, deliveredSettlement } from '../schedule/request-endings.ts';

export function cancelledRequest(run: CancelledRun): Settlement {
  const request = requestRecordOf(run.record);
  if (request === undefined) {
    return cancelledAsAsked(run);
  }
  if (run.answer !== null) {
    return answeredSettlement(run.answer);
  }
  const { deliveredAt } = interactionWorkOf(run.work);
  return deliveredAt !== null && !takesAnswer(request) ? deliveredSettlement(deliveredAt) : cancelledAsAsked(run);
}
