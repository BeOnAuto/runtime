import { renderClock } from '@on.auto/definitions/template';
import type { Issue, PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { saidOfARefusal, type ReplyRefusal } from '../facts/run-facts.ts';
import { toldUnknowingly, type TellingsReader } from '../tellings/own-messages.ts';
import { lineCallOf, type TellingCall } from '../tellings/telling-calls.ts';
import type { KeptRequest, Reply } from './reply-taking.ts';
import { routeOfRequest } from './request-routes.ts';
import { answeredAlreadyWords, tellingWords } from './telling-words.ts';

export interface IntakeState {
  readonly taken: number;
  readonly refused: number;
  readonly foundAnswerer: boolean;
  readonly answered: ReadonlySet<string>;
  readonly told: ReadonlyMap<string, number>;
  readonly lastSaid: ReadonlyMap<string, string>;
  readonly unrecorded: boolean;
}

export const nothingTaken: IntakeState = {
  taken: 0,
  refused: 0,
  foundAnswerer: false,
  answered: new Set(),
  told: new Map(),
  lastSaid: new Map(),
  unrecorded: false,
};

export function carriedOn(state: IntakeState): IntakeState {
  return { ...state, taken: 0, refused: 0, unrecorded: false };
}

export const replyBoundsOfAReading = { told: 3, issues: 16 } as const;

function mayTell(state: IntakeState, request: KeptRequest): boolean {
  return request.row.refusals_told + (state.told.get(request.runId) ?? 0) < replyBoundsOfAReading.told;
}

export interface RefusalTold {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
  readonly open: number;
}

function saidJustBefore(state: IntakeState, { request, because, issues }: RefusalTold): boolean {
  return (state.lastSaid.get(request.runId) ?? request.row.last_said) === saidOfARefusal(because, issues);
}

function toldToAnother({ request, because }: RefusalTold): boolean {
  return because === 'not_the_answerer' && routeOfRequest(request).telling.tellsOthers !== true;
}

function mayTellAgain(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  request: KeptRequest,
): Effect.Effect<boolean> {
  return mayTell(state, request)
    ? Effect.map(toldUnknowingly(ledger, playbook, request.runId), (unknown) => !unknown)
    : Effect.succeed(false);
}

function mayTellNow(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  refusal: RefusalTold,
): Effect.Effect<boolean> {
  return saidJustBefore(state, refusal) || toldToAnother(refusal)
    ? Effect.succeed(false)
    : mayTellAgain(ledger, playbook, state, refusal.request);
}

export function answeredAlreadyTellingOf(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  { request, reply }: Pick<RefusalTold, 'request' | 'reply'>,
): Effect.Effect<TellingCall | undefined> {
  return Effect.gen(function* () {
    const clock = yield* renderClock;
    const said = { to: request.row.party, sent: request.sent, reply, message: answeredAlreadyWords };
    return (yield* mayTellAgain(ledger, playbook, state, request))
      ? lineCallOf(routeOfRequest(request).telling, 'refused', said, clock)
      : undefined;
  });
}

export function refusalTellingOf(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  state: IntakeState,
  refusal: RefusalTold,
): Effect.Effect<TellingCall | undefined> {
  const { request, reply, because, issues, open } = refusal;
  const route = routeOfRequest(request);
  const namesItsMessage = route.replies.read.each.to !== undefined;
  const message = tellingWords({ rule: request.rule, because, issues, open, namesItsMessage });
  return Effect.gen(function* () {
    const clock = yield* renderClock;
    const said = { to: request.row.party, sent: request.sent, reply, message };
    return (yield* mayTellNow(ledger, playbook, state, refusal))
      ? lineCallOf(route.telling, 'refused', said, clock)
      : undefined;
  });
}
