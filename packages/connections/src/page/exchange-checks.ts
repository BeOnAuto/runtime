import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import {
  answerDocument,
  valueAt,
  type AssertionChecked,
  type CallAnswer,
  type CalledOnce,
  type ExchangeAuth,
} from '@on.auto/tool-servers';

import type { ConnectionServices } from '../operations/connection-services.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { detailOf } from './consent-words.ts';
import { exchangeWords } from './exchange-words.ts';
import { unansweredWordsOf } from './unanswered-words.ts';

export type ExchangeChecking = Pick<
  ConnectionServices,
  | 'providers'
  | 'providerValues'
  | 'modelProviders'
  | 'policy'
  | 'resolve'
  | 'readOnceThrough'
  | 'fetch'
  | 'subjectTokens'
>;

export const mostReachedNames = 50;

export interface Reached {
  readonly reached: readonly string[] | undefined;
}

type ExchangeRefusal = InvalidInput | Unavailable | Conflict;

export interface ReachedAt {
  readonly list: string;
  readonly name: string;
}

type Named = Pick<KeptConnection['connection'], 'name' | 'provider' | 'status'>;

export function cannotConnectAsSetUp({ name }: Pick<Named, 'name'>, issues: InvalidInput['issues']): InvalidInput {
  return new InvalidInput({ detail: `The connection ${name} cannot connect as it is set up.`, issues });
}

export function signsNoTokens({ name }: Pick<Named, 'name'>): Conflict {
  return new Conflict({ detail: exchangeWords.signsNoTokens(name) });
}

export function reachesNothingYet({ name }: Pick<Named, 'name'>): Conflict {
  return new Conflict({ detail: exchangeWords.nothingReached(name) });
}

export function checkedNothing({ name }: Pick<Named, 'name'>): Unavailable {
  return new Unavailable({ detail: exchangeWords.unchecked(name) });
}

export function exchangeRefusalOf(
  connection: Named,
  { token_endpoint: issuer }: Pick<ExchangeAuth, 'token_endpoint'>,
  checked: AssertionChecked,
): ExchangeRefusal | undefined {
  const { name, provider, status } = connection;
  if (checked.kind === 'taken') {
    return undefined;
  }
  if (checked.kind === 'refused') {
    return cannotConnectAsSetUp(connection, [{ pointer: '', detail: exchangeWords.refused(checked.code) }]);
  }
  if (checked.kind === 'unreached') {
    return new Unavailable({ detail: exchangeWords.unreached(checked.hosts) });
  }
  if (checked.kind === 'unanswered') {
    return new Unavailable({ detail: unansweredWordsOf(exchangeWords.unanswered(name), checked.call) });
  }
  const named = { name, issuer, provider, connected: status === 'connected', throughAGateway: false };
  return new Conflict({ detail: detailOf(named, checked.refusal) });
}

function nameOf(item: unknown, pointer: string): readonly string[] {
  const value = valueAt(item, pointer);
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return [String(value)];
  }
  return typeof value === 'string' && value !== '' ? [value] : [];
}

export function namesReachedIn(answer: CallAnswer, { list, name }: ReachedAt, most: number): readonly string[] {
  const items = valueAt(answerDocument(answer), list);
  return Array.isArray(items) ? items.flatMap((item: unknown) => nameOf(item, name)).slice(0, most) : [];
}

export function reachedOf(
  called: CalledOnce,
  toldRefused: boolean,
  reachedAt: ReachedAt,
  most: number,
): readonly string[] | undefined {
  if (toldRefused) {
    return [];
  }
  if (called.kind !== 'answered') {
    return undefined;
  }
  if (called.outcome === 'result') {
    return namesReachedIn(called.answer, reachedAt, most);
  }
  return called.outcome === 'tool_error' ? [] : undefined;
}
