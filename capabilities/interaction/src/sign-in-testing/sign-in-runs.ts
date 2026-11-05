import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import {
  noCalledDefinitions,
  onTheStandingClock,
  recordingJournal,
  type RecordingJournal,
} from '@on.auto/definitions/testing';
import { OrgMembership, allPermissions, type CallerIdentity } from '@on.auto/operations';
import { serveFakeMcp, type FakeMcpServer, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, type Exit, type Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';
import { signInLink } from './sign-in-tools.ts';

export const signInRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

export const priya: CallerIdentity = {
  id: 'person:user_7kLm2',
  name: 'Priya Shah',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const priyasAgent: CallerIdentity = {
  ...priya,
  client: { id: 'https://agent.example/client.json', name: 'Agent of Priya', domain: 'agent.example' },
};

export const sam: CallerIdentity = { ...priya, id: 'person:user_9sAm4', name: 'Sam Okafor' };

export const keyHolder: CallerIdentity = { ...priya, id: 'abk_ops', name: 'abk_ops' };

export const thePlaybookItself: CallerIdentity = { ...priya, id: 'playbook:alpha', name: 'alpha' };

export const localDeveloper: CallerIdentity = { ...priya, id: 'local', name: 'sam' };

type Answering = FakeTool['answer'];

type ToolResult = Awaited<ReturnType<Answering>>;

export function answered(answer: Schema.JsonObject): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer };
}

export const signedInAnswer = () => answered({ signed_in: true });

export const linkedAnswer = () => answered({ signed_in: false, link: signInLink, until: '2026-10-08T09:00:00.000Z' });

export const signedOutAnswer = () => answered({ signed_in: false });

function entry(url: string, key: string) {
  return { url, headers: { Authorization: `Bearer \${${key}}` }, org: 'acme' };
}

function browserTool(answer: Answering): FakeTool {
  return {
    name: 'browser_sign_in',
    description: 'Hands the browser to the person to sign in to a site, and keeps the sign-in for them alone.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string' },
        request: { type: 'string' },
        until: { type: 'string' },
        ask: { type: 'boolean' },
      },
      required: ['site'],
    },
    answer,
  };
}

export interface SignInRunOptions {
  readonly answer: Answering;
  readonly membership?: (org: string, person: string) => Effect.Effect<boolean>;
  readonly openRequests?: number;
}

interface RunAs {
  readonly caller?: CallerIdentity;
  readonly actsFor?: string;
  readonly input?: Schema.Json;
}

export interface SignInRuns {
  readonly browser: FakeMcpServer;
  readonly chat: FakeMcpServer;
  readonly journal: RecordingJournal;
  readonly run: (source: string, as?: RunAs) => Promise<Exit.Exit<CapabilityAnswer, CapabilityRejection>>;
}

const browserKey = 'browser-api-key-3f9b2c41';

const chatKey = 'chat-api-key-8d1e6a03';

function contextOf(journal: RecordingJournal, { caller = priya, actsFor }: RunAs): RunContext {
  const context: RunContext = {
    id: signInRunId,
    org: 'acme',
    playbook: 'alpha',
    caller,
    definition: { name: 'supplier-portal-sign-in', version: 1 },
    journal,
    lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', correlationId: signInRunId },
    depth: 0,
    callDepth: 0,
    ...noCalledDefinitions,
  };
  return actsFor === undefined ? context : { ...context, actsFor };
}

export async function signInRuns(options: SignInRunOptions): Promise<SignInRuns> {
  const browser = await serveFakeMcp({
    bearer: browserKey,
    tools: [browserTool(options.answer)],
  });
  onTestFinished(browser.close);
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true });
  onTestFinished(chat.close);
  const { access } = reportingAccess(
    { browser: entry(browser.url, 'BROWSER_KEY'), chat: entry(chat.url, 'CHAT_KEY') },
    { environment: { BROWSER_KEY: browserKey, CHAT_KEY: chatKey } },
  );
  onTestFinished(access.close);
  const capability = makeInteractionFunctionAdapter({
    tools: access,
    openRequests: () => Effect.succeed(options.openRequests ?? 0),
    mostOpenRequests: 10,
  });
  const journal = recordingJournal();
  return {
    browser,
    chat,
    journal,
    run: (source, as = {}) =>
      Effect.runPromiseExit(
        onTheStandingClock(
          Effect.flatMap(capability.prepare(source), (prepared) =>
            prepared.run(as.input ?? {}, contextOf(journal, as)),
          ),
        ).pipe(Effect.provideService(OrgMembership, options.membership ?? (() => Effect.succeed(true)))),
      ),
  };
}
