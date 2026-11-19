import type { AppRuntime, RegisterRoutes } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';

import { answersServedBy, type AnswerStores } from './served-answers.ts';
import { eventsServedBy, type EventStores } from './served-events.ts';

export interface DeliveryStores {
  readonly answerStores?: AnswerStores | undefined;
  readonly eventStores?: EventStores | undefined;
}

export function deliveryRoutesOf(
  runtime: AppRuntime<DispatcherServices>,
  { answerStores, eventStores }: DeliveryStores,
): readonly RegisterRoutes[] {
  return [
    ...(answerStores === undefined ? [] : [answersServedBy(runtime, answerStores)]),
    ...(eventStores === undefined ? [] : [eventsServedBy(runtime, eventStores)]),
  ];
}
