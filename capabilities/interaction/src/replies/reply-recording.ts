import { renderClock, type RenderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { Issue, PlaybookAddress } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { ReplyRefusal } from '../facts/run-facts.ts';
import { toldUnknowingly, type TellingsReader } from '../tellings/own-messages.ts';
import type { KeptRequest } from './reply-taking.ts';
import { routeOfRequest, type RepliesRoute } from './request-routes.ts';
import { tellingWords } from './telling-words.ts';

export interface IntakeState {
  readonly taken: number;
  readonly refused: number;
  readonly foundAnswerer: boolean;
  readonly answered: ReadonlySet<string>;
  readonly told: ReadonlyMap<string, number>;
  readonly unrecorded: boolean;
}

export const nothingTaken: IntakeState = {
  taken: 0,
  refused: 0,
  foundAnswerer: false,
  answered: new Set(),
  told: new Map(),
  unrecorded: false,
};

export function carriedOn(state: IntakeState): IntakeState {
  return { ...state, taken: 0, refused: 0, unrecorded: false };
}

export const replyBoundsOfAReading = { told: 3, issues: 16 } as const;

function tellingInput({ replies }: RepliesRoute, request: KeptRequest, message: string, clock: RenderClock) {
  const variables = { to: request.row.party, sent: { ...request.sent }, message };
  const rendered = replies.tell === undefined ? undefined : renderedArguments(replies.tell.with, variables, clock);
  return rendered !== undefined && Result.isSuccess(rendered) ? rendered.success.input : undefined;
}

function mayTell(state: IntakeState, request: KeptRequest): boolean {
  return request.row.refusals_told + (state.told.get(request.runId) ?? 0) < replyBoundsOfAReading.told;
}

export interface RefusalTold {
  readonly request: KeptRequest;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
}

function mayTellNow(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  request: KeptRequest,
): Effect.Effect<boolean> {
  return mayTell(state, request)
    ? Effect.map(toldUnknowingly(ledger, playbook, request.runId), (unknown) => !unknown)
    : Effect.succeed(false);
}

export function tellingInputOf(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  { request, because, issues }: RefusalTold,
) {
  return Effect.gen(function* () {
    const clock = yield* renderClock;
    return (yield* mayTellNow(ledger, playbook, state, request))
      ? tellingInput(routeOfRequest(request), request, tellingWords(request.rule, because, issues), clock)
      : undefined;
  });
}
