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

const tenThousandths = 10_000;

export function tenThousandthsOf(fraction: number): number {
  return Math.round(fraction * tenThousandths);
}

export function fractionOf(kept: number): number {
  return kept / tenThousandths;
}

export function isFraction(value: number): boolean {
  return value >= 0 && value <= 1 && fractionOf(tenThousandthsOf(value)) === value;
}

const FractionSchema = Schema.Finite.check(
  Schema.makeFilter((value: number) => isFraction(value), { expected: 'a number from 0 to 1 with at most 4 decimals' }),
);

const AnchorSchema = Schema.Struct({ x: FractionSchema, y: FractionSchema });

export type Anchor = typeof AnchorSchema.Type;

const CommentMadeSchema = factOf(
  'comment_made',
  Schema.Struct({
    address: Schema.String,
    text: Schema.String,
    made_by: RecordedCallerSchema,
    anchor: Schema.optionalKey(AnchorSchema),
    definition: Schema.optionalKey(Schema.String),
  }),
  ActedContextSchema,
);

const CommentResolvedSchema = factOf('comment_resolved', Schema.Struct({ how: ResolvedHowSchema }), ActedContextSchema);

const CommentReopenedSchema = factOf('comment_reopened', Schema.Struct({}), ActedContextSchema);

export const CommentEventSchema = Schema.Union([CommentMadeSchema, CommentResolvedSchema, CommentReopenedSchema]);

export type RecordedCommentEvent = typeof CommentEventSchema.Type;

export const commentStreamKind = 'comments';

export function commentStreamOf(id: string): string {
  return `${commentStreamKind}/${id}`;
}

interface Acting {
  readonly at: string;
  readonly by: string;
}

interface CommentResolution extends Acting {
  readonly how: ResolvedHow;
}

export interface CommentState {
  readonly address: string;
  readonly definition: string | null;
  readonly text: string;
  readonly anchor: Anchor | null;
  readonly madeBy: RecordedCaller;
  readonly at: string;
  readonly resolution: CommentResolution | null;
  readonly reopening: Acting | null;
}

export interface MakeComment extends Acting {
  readonly kind: 'make';
  readonly address: string;
  readonly definition: string | null;
  readonly text: string;
  readonly anchor: Anchor | null;
  readonly madeBy: RecordedCaller;
}

export interface ResolveComment extends Acting {
  readonly kind: 'resolve';
  readonly how: ResolvedHow;
}

export interface ReopenComment extends Acting {
  readonly kind: 'reopen';
}

type CommentCommand = MakeComment | ResolveComment | ReopenComment;

function evolved(state: CommentState | null, recorded: RecordedCommentEvent): CommentState | null {
  if (recorded.type === 'comment_made') {
    const { address, definition = null, text, made_by: madeBy, anchor = null } = recorded.data;
    return { address, definition, text, anchor, madeBy, at: recorded.context.at, resolution: null, reopening: null };
  }
  if (state === null) {
    return null;
  }
  return recorded.type === 'comment_resolved'
    ? { ...state, resolution: { ...recorded.context, how: recorded.data.how } }
    : { ...state, resolution: null, reopening: recorded.context };
}

function madeOf({ address, definition, text, anchor, madeBy }: MakeComment): Decided<RecordedCommentEvent> {
  const placed = anchor === null ? {} : { anchor };
  const about = definition === null ? {} : { definition };
  return { type: 'comment_made', data: { address, text, made_by: madeBy, ...placed, ...about } };
}

function decided(command: CommentCommand, state: CommentState | null): readonly Decided<RecordedCommentEvent>[] {
  if (command.kind === 'make') {
    return state === null ? [madeOf(command)] : [];
  }
  if (state === null) {
    return [];
  }
  if (command.kind === 'reopen') {
    return state.resolution === null ? [] : [{ type: 'comment_reopened', data: {} }];
  }
  return state.resolution === null ? [{ type: 'comment_resolved', data: { how: command.how } }] : [];
}

export const commentDecider: Decider<CommentState | null, CommentCommand, RecordedCommentEvent> = {
  initialState: null,
  evolve: evolved,
  decide: (command, state) => Result.succeed(decided(command, state)),
  context: ({ at, by }) => ({ at, by }),
  eventSchema: CommentEventSchema,
};
