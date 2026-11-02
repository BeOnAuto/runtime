import {
  ActedContextSchema,
  RecordedCallerSchema,
  factOf,
  type Decided,
  type Decider,
  type RecordedCaller,
} from '@on.auto/operations';
import { Result, Schema } from 'effect';

export const ResolvedHowSchema = Schema.Literals(['acted', 'dismissed']);

export type ResolvedHow = typeof ResolvedHowSchema.Type;

const CommentMadeSchema = factOf(
  'comment_made',
  Schema.Struct({ address: Schema.String, text: Schema.String, made_by: RecordedCallerSchema }),
  ActedContextSchema,
);

const CommentResolvedSchema = factOf('comment_resolved', Schema.Struct({ how: ResolvedHowSchema }), ActedContextSchema);

export const CommentEventSchema = Schema.Union([CommentMadeSchema, CommentResolvedSchema]);

export type RecordedCommentEvent = typeof CommentEventSchema.Type;

export const commentStreamKind = 'comments';

export function commentStreamOf(id: string): string {
  return `${commentStreamKind}/${id}`;
}

interface CommentResolution {
  readonly at: string;
  readonly by: string;
  readonly how: ResolvedHow;
}

export interface CommentState {
  readonly address: string;
  readonly text: string;
  readonly madeBy: RecordedCaller;
  readonly at: string;
  readonly resolution: CommentResolution | null;
}

interface Acting {
  readonly at: string;
  readonly by: string;
}

export interface MakeComment extends Acting {
  readonly kind: 'make';
  readonly address: string;
  readonly text: string;
  readonly madeBy: RecordedCaller;
}

export interface ResolveComment extends Acting {
  readonly kind: 'resolve';
  readonly how: ResolvedHow;
}

type CommentCommand = MakeComment | ResolveComment;

function evolved(state: CommentState | null, recorded: RecordedCommentEvent): CommentState | null {
  if (recorded.type === 'comment_made') {
    const { address, text, made_by: madeBy } = recorded.data;
    return { address, text, madeBy, at: recorded.context.at, resolution: null };
  }
  return state === null ? null : { ...state, resolution: { ...recorded.context, how: recorded.data.how } };
}

function decided(command: CommentCommand, state: CommentState | null): readonly Decided<RecordedCommentEvent>[] {
  if (command.kind === 'make') {
    const { address, text, madeBy } = command;
    return state === null ? [{ type: 'comment_made', data: { address, text, made_by: madeBy } }] : [];
  }
  return state === null || state.resolution !== null ? [] : [{ type: 'comment_resolved', data: { how: command.how } }];
}

export const commentDecider: Decider<CommentState | null, CommentCommand, RecordedCommentEvent> = {
  initialState: null,
  evolve: evolved,
  decide: (command, state) => Result.succeed(decided(command, state)),
  context: ({ at, by }) => ({ at, by }),
  eventSchema: CommentEventSchema,
};
