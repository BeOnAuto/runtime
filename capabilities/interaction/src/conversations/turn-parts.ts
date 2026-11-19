import type { Effect } from 'effect';

import type { RequestInputs } from '../readings/request-readings.ts';
import type { IntakeState } from '../replies/reply-recording.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import type { ConversationParts, ConversationPlace } from './conversation-parts.ts';
import type { ReadAnswer } from './read-answers.ts';

export interface ConversationTurn {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
  readonly candidates: readonly KeptRequest[];
  readonly inputs: RequestInputs;
  readonly endedMessages: Effect.Effect<ReadonlySet<string>>;
  readonly roomForACall: Effect.Effect<boolean>;
  readonly heldUntil: number;
}

export interface OneRead {
  readonly reading: string | undefined;
  readonly request: KeptRequest;
  readonly since: string | null;
  readonly namesItsMessage: boolean;
}

export interface ReadDone {
  readonly answer: ReadAnswer;
  readonly state: IntakeState;
}
