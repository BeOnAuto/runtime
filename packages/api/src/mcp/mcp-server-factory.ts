import type { McpServer } from '@modelcontextprotocol/server';
import {
  type CallerIdentity,
  type OperationScope,
  type RegisteredLink,
  type RegisteredPlainLanguage,
  type Registration,
  type RouteRegistration,
  type Dispatcher,
  OperationsServed,
} from '@on.auto/operations';
import { Context, Effect, Result } from 'effect';

import {
  playbookCallOf,
  orgCallOf,
  type PlaybookCall,
  type HandedOff,
  type OrgCall,
} from '../hand-off/caller-hand-off.ts';
import { toolCallbackOf, type AnsweringServing, type ToolLink } from '../tools/linked-answers.ts';
import { namesAPlaybook, playbookArgumentOf, withoutPlaybook } from '../tools/playbook-argument.ts';
import type { Arguments, CalledTool, Dispatch } from '../tools/tool-callback.ts';
import {
  orgToolDefinitionsBeside,
  toolDefinitionOf,
  toolDefinitionTakingPlaybookOf,
  twinsIn,
  type ToolDefinition,
  type Twins,
} from '../tools/tool-definition.ts';
import type { ServedTools } from './instructions.ts';
import { connectionOf, serverOf, type Connection, type EveryTool, type McpServing } from './mcp-connection.ts';

export type ToolServing = McpServing & AnsweringServing;

export type McpServerFactory = (context: HandedOff) => McpServer;

interface Offered<R extends Registration> {
  readonly registration: R;
  readonly definition: ToolDefinition;
  readonly plainLanguage: RegisteredPlainLanguage;
}

interface Dispatching {
  readonly dispatch: Dispatch;
  readonly link?: ToolLink;
}

interface Tool extends CalledTool, Dispatching {
  readonly name: string;
  readonly definition: ToolDefinition;
}

function plainLanguageOf({ name, plainLanguage }: Registration): RegisteredPlainLanguage {
  if (plainLanguage === undefined) {
    throw new Error(`The operation ${name} has no plain language for the results of its MCP tool`);
  }
  return plainLanguage;
}

function offered<R extends Registration>(
  registrations: readonly R[],
  definitionOf: (registration: R) => ToolDefinition,
): readonly Offered<R>[] {
  return registrations.map((registration) => ({
    registration,
    definition: definitionOf(registration),
    plainLanguage: plainLanguageOf(registration),
  }));
}

function servedAsTools<S extends OperationScope>(
  registrations: readonly RouteRegistration<S>[],
): readonly Registration<S>[] {
  return registrations.filter((registration) => registration.servedOverHttpAlone === undefined);
}

function permittedTo<R extends Registration>(
  { permissions }: CallerIdentity,
  offers: readonly Offered<R>[],
): readonly Offered<R>[] {
  return offers.filter(({ registration }) =>
    registration.permissions.some((permission) => permissions.includes(permission)),
  );
}

function namesOf(offers: readonly Offered<Registration>[]): readonly string[] {
  return offers.map(({ registration }) => registration.name);
}

function servedTools(
  orgOffers: readonly Offered<Registration>[],
  playbookOffers: readonly Offered<Registration>[],
): ServedTools {
  return { orgTools: namesOf(orgOffers), playbookTools: namesOf(playbookOffers) };
}

function everyToolOf(
  orgOffers: readonly Offered<Registration>[],
  playbookOffers: readonly Offered<Registration>[],
): EveryTool {
  return {
    served: servedTools(orgOffers, playbookOffers),
    listed: [...orgOffers, ...playbookOffers].map(({ registration, definition }) => ({
      name: registration.name,
      definition,
    })),
  };
}

function asGiven(input: Arguments): Arguments {
  return input;
}

function toolsOf<R extends Registration>(
  offers: readonly Offered<R>[],
  dispatchOf: (registration: R) => Dispatching,
  operationInputOf: (registration: R) => (input: Arguments) => Arguments = () => asGiven,
): readonly Tool[] {
  return offers.map(({ registration, definition, plainLanguage }) => ({
    name: registration.name,
    definition,
    kind: registration.kind,
    plainLanguage,
    operationInputOf: operationInputOf(registration),
    ...dispatchOf(registration),
  }));
}

function orgInputBeside(twins: Twins): (registration: Registration<'org'>) => (input: Arguments) => Arguments {
  return ({ name }) => (twins.has(name) ? withoutPlaybook : asGiven);
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

interface ConnectedCall {
  readonly connection: Connection;
  readonly serving: ToolServing;
  readonly call: OrgCall;
}

function servingBeside(call: OrgCall, served: ServedTools): OrgCall {
  const names = new Set([...served.orgTools, ...served.playbookTools]);
  return { ...call, context: Context.add(call.context, OperationsServed, (name: string) => names.has(name)) };
}

function serverWithTools(connected: ConnectedCall, served: ServedTools, tools: readonly Tool[]): McpServer {
  const { connection, serving, call } = connected;
  const callBeside = servingBeside(call, served);
  const session = {
    connection,
    actingAs: { caller: call.caller, org: call.org },
    states: serving.linkedAnswers.states,
  };
  return serverOf(session, served, (server) => {
    for (const tool of tools) {
      server.registerTool(tool.name, tool.definition, toolCallbackOf(serving, callBeside, tool));
    }
  });
}

function orgDispatchOf(
  dispatcher: Dispatcher,
  call: OrgCall,
  twins: Twins,
): (registration: Registration<'org'>) => Dispatching {
  const { caller, org } = call;
  const dispatchToTwin = playbookArgumentDispatchTo(dispatcher, call);
  const dispatchTo =
    (registration: Registration<'org'>): Dispatch =>
    (input) => {
      const twin = twins.get(registration.name);
      return twin !== undefined && namesAPlaybook(input)
        ? dispatchToTwin(twin)(input)
        : dispatcher.dispatchToOrg(registration, { caller, org, input, encoding: 'json' });
    };
  return (registration) => dispatchingOf(dispatchTo, registration, registration.link);
}

function playbookDispatchOf(
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
): (registration: Registration<'playbook'>) => Dispatch {
  return (registration) => (input) => {
    const argument = playbookArgumentOf(input);
    return Result.isFailure(argument)
      ? Effect.succeed(argument.failure)
      : dispatcher.dispatchToPlaybook(registration, { caller, org, ...argument.success, encoding: 'json' });
  };
}

function playbookArgumentDispatchOf(
  dispatcher: Dispatcher,
  call: OrgCall,
): (registration: Registration<'playbook'>) => Dispatching {
  const dispatchTo = playbookArgumentDispatchTo(dispatcher, call);
  return (registration) => dispatchingOf(dispatchTo, registration, registration.link);
}

interface OrgServing {
  readonly registrations: readonly Registration<'org'>[];
  readonly twins: Twins;
  readonly offers: readonly Offered<Registration<'org'>>[];
}

function orgServingOf(serving: ToolServing): OrgServing {
  const registrations = servedAsTools(serving.catalog.operationsIn('org'));
  const twins = twinsIn(registrations, servedAsTools(serving.catalog.operationsIn('playbook')));
  return { registrations, twins, offers: offered(registrations, orgToolDefinitionsBeside(twins)) };
}

export function orgServerFactory(serving: ToolServing): McpServerFactory {
  const { twins, offers: orgOffers } = orgServingOf(serving);
  const connection = connectionOf('org', serving, everyToolOf(orgOffers, []));
  return (context) => {
    const call = orgCallOf(context);
    const listed = permittedTo(call.caller, orgOffers);
    const tools = toolsOf(listed, orgDispatchOf(serving.dispatcher, call, twins), orgInputBeside(twins));
    return serverWithTools({ connection, serving, call }, servedTools(listed, []), tools);
  };
}

export function playbookServerFactory(serving: ToolServing): McpServerFactory {
  const playbookOffers = offered(servedAsTools(serving.catalog.operationsIn('playbook')), toolDefinitionOf);
  const connection = connectionOf('playbook', serving, everyToolOf([], playbookOffers));
  return (context) => {
    const call = playbookCallOf(context);
    const listed = permittedTo(call.caller, playbookOffers);
    const tools = toolsOf(listed, playbookDispatchOf(serving.dispatcher, call));
    return serverWithTools({ connection, serving, call }, servedTools([], listed), tools);
  };
}

function namedInPlaybookAlone(
  playbookRegistrations: readonly Registration<'playbook'>[],
  orgRegistrations: readonly Registration<'org'>[],
): readonly Registration<'playbook'>[] {
  const orgNames = new Set(orgRegistrations.map(({ name }) => name));
  return playbookRegistrations.filter(({ name }) => !orgNames.has(name));
}

export function catalogServerFactory(serving: ToolServing): McpServerFactory {
  const { registrations: orgRegistrations, twins, offers: orgOffers } = orgServingOf(serving);
  const playbookOffers = offered(
    namedInPlaybookAlone(servedAsTools(serving.catalog.operationsIn('playbook')), orgRegistrations),
    toolDefinitionTakingPlaybookOf,
  );
  const connection = connectionOf('own org', serving, everyToolOf(orgOffers, playbookOffers));
  return (context) => {
    const call = orgCallOf(context);
    const listedInOrg = permittedTo(call.caller, orgOffers);
    const listedInPlaybook = permittedTo(call.caller, playbookOffers);
    const tools = [
      ...toolsOf(listedInOrg, orgDispatchOf(serving.dispatcher, call, twins), orgInputBeside(twins)),
      ...toolsOf(listedInPlaybook, playbookArgumentDispatchOf(serving.dispatcher, call), () => withoutPlaybook),
    ];
    return serverWithTools({ connection, serving, call }, servedTools(listedInOrg, listedInPlaybook), tools);
  };
}
