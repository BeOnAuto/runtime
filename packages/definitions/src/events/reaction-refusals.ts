import {
  playbookCallerOf,
  DefinitionContextSchema,
  factOf,
  type PlaybookAddress,
  type Decided,
  type Decider,
} from '@on.auto/operations';
import { Result, Schema } from 'effect';

export const reactionsStreamKind = 'reactions';

export const ReactionRefusedSchema = factOf(
  'reaction_refused',
  Schema.Struct({ count: Schema.Int, reason: Schema.String, minute: Schema.String }),
  DefinitionContextSchema,
);

export type RecordedReactionRefused = typeof ReactionRefusedSchema.Type;

export type ReactionRefused = Decided<RecordedReactionRefused>;

export interface ReactionRefusal {
  readonly playbook: PlaybookAddress;
  readonly workflow: string;
  readonly version: number;
  readonly refused: ReactionRefused['data'];
  readonly at: string;
}

export const reactionRefusalDecider: Decider<null, ReactionRefusal, RecordedReactionRefused> = {
  initialState: null,
  evolve: () => null,
  decide: ({ refused }) => Result.succeed([{ type: 'reaction_refused', data: refused }]),
  context: ({ playbook, workflow, version, at }) => ({
    at,
    by: playbookCallerOf(playbook).id,
    definitionType: 'workflow',
    definitionName: workflow,
    definitionVersion: version,
  }),
  eventSchema: ReactionRefusedSchema,
};
