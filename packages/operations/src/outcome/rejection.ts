import type { CancelledKind, RunCancelled } from './cancelled-run.ts';
import type { Conflict, ConflictKind } from './conflict.ts';
import type { Forbidden } from './forbidden.ts';
import type { InvalidInput, InvalidInputKind } from './invalid-input.ts';
import type { NotFound } from './not-found.ts';
import type { RunUnanswered, UnansweredKind } from './unanswered-run.ts';
import type { Unavailable, UnavailableKind } from './unavailable.ts';

type AnyRejection = NotFound | Conflict | Unavailable | InvalidInput | RunCancelled | RunUnanswered | Forbidden;

export type DeclarableReason = AnyRejection['_tag'];

export type RejectionKind = InvalidInputKind | ConflictKind | UnavailableKind | CancelledKind | UnansweredKind;

export type Rejection<R extends DeclarableReason = DeclarableReason> = Extract<AnyRejection, { readonly _tag: R }>;
