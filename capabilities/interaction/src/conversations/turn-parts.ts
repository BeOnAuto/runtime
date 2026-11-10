import type { Effect } from 'effect';

import type { IntakeState } from '../replies/reply-recording.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import type { ConversationParts, ConversationPlace } from './conversation-parts.ts';
import type { ReadAnswer } from './read-answers.ts';

export interface ConversationTurn {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
  readonly candidates: readonly KeptRequest[];
  readonly roomForACall: Effect.Effect<boolean>;
}

export interface OneRead {
  readonly reading: string | undefined;
  readonly request: KeptRequest;
  readonly since: string | null;
}

export interface ReadDone {
  readonly answer: ReadAnswer;
  readonly state: IntakeState;
}
