import { changingEvents, type Presenter } from '@on.auto/operations';

import {
  ReactionRefusedSchema,
  reactionsStreamKind,
  type RecordedReactionRefused,
} from '../events/reaction-refusals.ts';
import { reactionsRefused } from '../plain-language/event-words.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function accountOf({ data, context }: RecordedReactionRefused): Account {
  const { count, reason, minute } = data;
  return {
    summary: reactionsRefused(cutAtCodePoint(context.definitionName, mostNameBytes)),
    data: { count, reason: cutAtCodePoint(reason, mostDetailBytes), minute },
  };
}

export const reactionRefusedPresenter: Presenter = eventPresenter<RecordedReactionRefused>({
  streamKind: reactionsStreamKind,
  eventSchema: ReactionRefusedSchema,
  types: ['reaction_refused'],
  account: accountOf,
  changes: changingEvents(['reaction_refused']),
});
