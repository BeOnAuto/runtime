import {
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
} from '@modelcontextprotocol/server';
import type { LinkToOpen, OfferedLink, RegisteredPlainLanguage } from '@on.auto/operations';
import { Option, Redacted, Schema } from 'effect';

import { orgCallOf, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { callbackFor, type CalledTool, type CallServing, type Dispatch, type ToolContext } from './tool-callback.ts';

interface StateCodec {
  mint(payload: Readonly<Record<string, unknown>>, context?: ToolContext): Promise<string>;
  verify(state: string, context: ToolContext): Promise<unknown>;
}

export interface LinkedAnswers {
  readonly states: StateCodec;
}

export interface AnsweringServing extends CallServing {
  readonly linkedAnswers: LinkedAnswers;
}

export interface ToolLink {
  readonly toOpen: (output: unknown) => LinkToOpen | undefined;
  readonly idOf: (output: unknown) => string;
  readonly dispatchAfter: (offered: OfferedLink) => Dispatch;
}

interface LinkingTool extends CalledTool {
  readonly link?: ToolLink;
}

interface LinkOwner {
  readonly tool: string;
  readonly caller: string;
  readonly org: string;
}

type AskingToOpen = (input: unknown, context: ToolContext) => Promise<CallToolResult | InputRequiredResult>;

const theLink = 'link';

const declinedToOpen = 'The person declined to open the page, and its link is in this answer.';

const OpensLinksSchema = Schema.Struct({
  [CLIENT_CAPABILITIES_META_KEY]: Schema.Struct({
    elicitation: Schema.Struct({ url: Schema.Record(Schema.String, Schema.Unknown) }),
  }),
});

const OfferedLinkStateSchema = Schema.Struct({
  tool: Schema.String,
  caller: Schema.String,
  org: Schema.String,
  id: Schema.String,
  url: Schema.String,
});

const BoundContextSchema = Schema.Struct({
  http: Schema.Struct({ authInfo: Schema.Struct({ extra: Schema.Record(Schema.String, Schema.Unknown) }) }),
});

const opensLinks = Schema.is(OpensLinksSchema);

const boundContextOf = Schema.decodeUnknownSync(BoundContextSchema);

const offeredLinkStateOf = Schema.decodeUnknownOption(OfferedLinkStateSchema);

function callerAndOrgOf(context: unknown): string {
  const { caller, org } = orgCallOf(boundContextOf(context).http);
  return JSON.stringify([caller.id, org]);
}

type RetryStateKey = Redacted.Redacted<Uint8Array>;

export interface RetryStateKeys {
  readonly current: RetryStateKey;
  readonly previous?: RetryStateKey | undefined;
}

function codecOf(key: RetryStateKey): StateCodec {
  return createRequestStateCodec({ key: Redacted.value(key), bind: callerAndOrgOf });
}

function eitherOf(current: StateCodec, previous: StateCodec): StateCodec {
  return {
    mint: (payload, context) => current.mint(payload, context),
    verify: (state, context) => current.verify(state, context).catch(() => previous.verify(state, context)),
  };
}

export function linkedAnswers({ current, previous }: RetryStateKeys): LinkedAnswers {
  const signing = codecOf(current);
  return { states: previous === undefined ? signing : eitherOf(signing, codecOf(previous)) };
}

function offeredLinkFor({ tool, caller, org }: LinkOwner, state: unknown): OfferedLink | undefined {
  return Option.getOrUndefined(
    Option.flatMap(offeredLinkStateOf(state), (kept) =>
      kept.tool === tool && kept.caller === caller && kept.org === org
        ? Option.some({ id: kept.id, url: kept.url })
        : Option.none(),
    ),
  );
}

function declinedToOpenIn({ mcpReq }: ToolContext): boolean {
  const response = inputResponse(mcpReq.inputResponses, theLink);
  return response.kind === 'elicit' && response.action !== 'accept';
}

function wordsAfterTheLink(
  plainLanguage: RegisteredPlainLanguage,
  { toOpen }: ToolLink,
  declined: boolean,
): RegisteredPlainLanguage {
  return {
    ...plainLanguage,
    outcome: (output, input) => {
      const words = plainLanguage.outcome(output, input);
      return toOpen(output) !== undefined && declined ? `${declinedToOpen} ${words}` : words;
    },
  };
}

function answeringAfterTheLink(
  tool: LinkingTool,
  link: ToolLink,
  offered: OfferedLink,
  context: ToolContext,
): CalledTool {
  return {
    ...tool,
    dispatch: link.dispatchAfter(offered),
    plainLanguage: wordsAfterTheLink(tool.plainLanguage, link, declinedToOpenIn(context)),
  };
}

function askingToOpen(serving: AnsweringServing, call: OrgCall, tool: LinkingTool, link: ToolLink): AskingToOpen {
  const owner = { tool: tool.name, caller: call.caller.id, org: call.org };
  const answering = callbackFor(serving, call, tool);
  return async (input, context) => {
    const offered = offeredLinkFor(owner, context.mcpReq.requestState());
    if (offered !== undefined) {
      return callbackFor(serving, call, answeringAfterTheLink(tool, link, offered, context))(input, context);
    }
    const answer = await answering(input, context);
    const output = answer.structuredContent;
    if (output === undefined || !opensLinks(context.mcpReq.envelope)) {
      return answer;
    }
    const toOpen = link.toOpen(output);
    return toOpen === undefined
      ? answer
      : inputRequired({
          inputRequests: { [theLink]: inputRequired.elicitUrl({ message: toOpen.message, url: toOpen.url }) },
          requestState: await serving.linkedAnswers.states.mint(
            { ...owner, id: link.idOf(output), url: toOpen.url },
            context,
          ),
        });
  };
}

export function toolCallbackOf(serving: AnsweringServing, call: OrgCall, tool: LinkingTool): AskingToOpen {
  const { link } = tool;
  return link === undefined ? callbackFor(serving, call, tool) : askingToOpen(serving, call, tool, link);
}
