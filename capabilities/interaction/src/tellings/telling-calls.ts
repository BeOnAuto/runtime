import type { RenderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { TellingAbout, TellingForm } from '@on.auto/tool-servers';
import { Result, type Schema } from 'effect';

import type { TellWord } from '../tool-blocks/tool-block-schemas.ts';
import type { TellingRoute } from './telling-routes.ts';

interface ToldReply {
  readonly id: string;
  readonly to?: string | undefined;
}

export interface Told {
  readonly to: string;
  readonly sent: { readonly conversation: string; readonly id: string };
  readonly reply?: ToldReply;
}

export interface Said extends Told {
  readonly message: string;
}

export interface StartedTelling {
  readonly about?: TellingAbout;
  readonly form?: TellingForm;
}

export interface TellingCall {
  readonly about: TellingAbout;
  readonly form: TellingForm;
  readonly tool: string;
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly idAt: string | undefined;
  readonly conversationAt: string | undefined;
}

const linesWhen: Readonly<Record<TellWord, readonly TellingAbout[]>> = {
  all: ['taken', 'refused', 'ended'],
  refusals: ['refused'],
  none: [],
};

function variablesOf({ to, sent, reply }: Told, message: string) {
  return { to, sent: { ...sent }, message, reply: { id: reply?.id ?? '', to: reply?.to ?? '' } };
}

function inputOf(written: Readonly<Record<string, Schema.Json>>, told: Told, message: string, clock: RenderClock) {
  const rendered = renderedArguments(written, variablesOf(told, message), clock);
  return Result.isSuccess(rendered) ? rendered.success.input : undefined;
}

export function tellsALine({ when, line }: TellingRoute, about: TellingAbout): boolean {
  return line !== undefined && linesWhen[when].includes(about);
}

export function marksATakenReply({ when, mark }: TellingRoute): boolean {
  return mark !== undefined && when !== 'none';
}

export function lineCallOf(
  telling: TellingRoute,
  about: TellingAbout,
  said: Said,
  clock: RenderClock,
): TellingCall | undefined {
  const { line } = telling;
  const input =
    line === undefined || !tellsALine(telling, about) ? undefined : inputOf(line.with, said, said.message, clock);
  return line === undefined || input === undefined
    ? undefined
    : { about, form: 'line', tool: line.tool, input, idAt: line.sent, conversationAt: line.conversationAt };
}

export function markCallOf(telling: TellingRoute, told: Told, clock: RenderClock): TellingCall | undefined {
  const { mark } = telling;
  const input = mark === undefined || !marksATakenReply(telling) ? undefined : inputOf(mark.with, told, '', clock);
  return mark === undefined || input === undefined
    ? undefined
    : { about: 'taken', form: 'mark', tool: mark.tool, input, idAt: undefined, conversationAt: undefined };
}
