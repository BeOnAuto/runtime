import type { RenderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

import type { KeptRequest } from './reply-taking.ts';
import type { RepliesRoute } from './request-routes.ts';

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

export function tellingInput({ replies }: RepliesRoute, request: KeptRequest, message: string, clock: RenderClock) {
  const variables = { to: request.row.party, sent: { ...request.sent }, message };
  const rendered = replies.tell === undefined ? undefined : renderedArguments(replies.tell.with, variables, clock);
  return rendered !== undefined && Result.isSuccess(rendered) ? rendered.success.input : undefined;
}

export function mayTell(state: IntakeState, request: KeptRequest): boolean {
  return request.row.refusals_told + (state.told.get(request.runId) ?? 0) < replyBoundsOfAReading.told;
}
