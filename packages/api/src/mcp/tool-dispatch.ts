import { type Dispatcher, type RegisteredLink, type Registration } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { OrgCall, PlaybookCall } from '../hand-off/caller-hand-off.ts';
import type { ToolLink } from '../tools/linked-answers.ts';
import { namesAPlaybook, playbookArgumentOf, withoutPlaybook } from '../tools/playbook-argument.ts';
import type { Arguments, Dispatch } from '../tools/tool-callback.ts';
import type { Twins } from '../tools/tool-definition.ts';

export interface Dispatching {
  readonly dispatch: Dispatch;
  readonly link?: ToolLink;
}

function dispatchingOf<R>(
  dispatchTo: (registration: R) => Dispatch,
  registration: R,
  link: RegisteredLink<R> | undefined,
): Dispatching {
  const dispatch = dispatchTo(registration);
  return link === undefined
    ? { dispatch }
    : {
        dispatch,
        link: {
          toOpen: link.toOpen,
          idOf: link.idOf,
          dispatchAfter: (offeredLink) => dispatchTo(link.answerAfter(offeredLink)),
          linkLastsMs: link.linkLastsMs,
        },
      };
}

export interface Listed {
  readonly directoryListing?: true;
}

export const everyListing: Listed = {};

export function orgDispatchOf(
  dispatcher: Dispatcher,
  call: OrgCall,
  twins: Twins,
  listed: Listed = everyListing,
): (registration: Registration<'org'>) => Dispatching {
  const { caller, org } = call;
  const dispatchToTwin = playbookArgumentDispatchTo(dispatcher, call, listed);
  const dispatchTo =
    (registration: Registration<'org'>): Dispatch =>
    (input) => {
      const twin = twins.get(registration.name);
      return twin !== undefined && namesAPlaybook(input)
        ? dispatchToTwin(twin)(input)
        : dispatcher.dispatchToOrg(registration, { caller, org, input, encoding: 'json', ...listed });
    };
  return (registration) => dispatchingOf(dispatchTo, registration, registration.link);
}

export function playbookDispatchOf(
  dispatcher: Dispatcher,
  { caller, org, playbook }: PlaybookCall,
): (registration: Registration<'playbook'>) => Dispatching {
  const dispatchTo =
    (registration: Registration<'playbook'>): Dispatch =>
    (input) =>
      dispatcher.dispatchToPlaybook(registration, { caller, org, playbook, input, encoding: 'json' });
  return (registration) => dispatchingOf(dispatchTo, registration, registration.link);
}

function playbookArgumentDispatchTo(
  dispatcher: Dispatcher,
  { caller, org }: OrgCall,
  listed: Listed,
): (registration: Registration<'playbook'>) => Dispatch {
  return (registration) => (input) => {
    const argument = playbookArgumentOf(input);
    return Result.isFailure(argument)
      ? Effect.succeed(argument.failure)
      : dispatcher.dispatchToPlaybook(registration, { caller, org, ...argument.success, encoding: 'json', ...listed });
  };
}

export function playbookArgumentDispatchOf(
  dispatcher: Dispatcher,
  call: OrgCall,
  listed: Listed,
): (registration: Registration<'playbook'>) => Dispatching {
  const dispatchTo = playbookArgumentDispatchTo(dispatcher, call, listed);
  return (registration) => dispatchingOf(dispatchTo, registration, registration.link);
}

export function withoutThePlaybook(): (input: Arguments) => Arguments {
  return withoutPlaybook;
}

export function asGiven(input: Arguments): Arguments {
  return input;
}

export function orgInputBeside(twins: Twins): (registration: Registration<'org'>) => (input: Arguments) => Arguments {
  return ({ name }) => (twins.has(name) ? withoutPlaybook : asGiven);
}
