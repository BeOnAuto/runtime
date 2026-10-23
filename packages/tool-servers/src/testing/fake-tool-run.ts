import type { RecordedContent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import type { CallReply } from '../calls/call-replies.ts';
import type { RunTools } from '../calls/run-tools.ts';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { reportingAccess } from './reporting-access.ts';
import {
  controlledSignals,
  recordingCallJournal,
  toolRun,
  type ControlledSignals,
  type RecordingCallJournal,
} from './tool-runs.ts';

export const fakeApiKey = 'graph-api-key-4f1d9a7c2b';

export interface FakeToolRun {
  readonly fake: FakeMcpServer;
  readonly content: RecordedContent;
  readonly tools: RunTools;
  readonly journal: RecordingCallJournal;
  readonly messages: () => readonly ServerMessage[];
  readonly call: (
    tool: string,
    input: Readonly<Record<string, unknown>>,
    signals?: ControlledSignals,
    room?: number,
  ) => Promise<CallReply>;
  readonly close: () => Promise<void>;
}

export async function openFakeToolRun(
  tools: readonly string[],
  timing?: Timing,
  options: FakeMcpOptions = {},
  entry: Readonly<Record<string, unknown>> = {},
): Promise<FakeToolRun> {
  const fake = await serveFakeMcp({ ...options, bearer: fakeApiKey });
  const { access, messages, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry } },
    { environment: { GRAPH_API_KEY: fakeApiKey }, ...(timing === undefined ? {} : { timing }) },
  );
  const journal = recordingCallJournal();
  const references = tools.map((tool) => ({ server: 'graph', tool }));
  const opened = await Effect.runPromise(access.open(toolRun(journal), references));
  const byName = new Map(opened.offered.map((tool) => [tool.name, tool]));
  let calls = 0;
  return {
    fake,
    content,
    tools: opened,
    journal,
    messages,
    call: (tool, input, signals, room) => {
      calls += 1;
      const offered = Option.getOrThrow(Option.fromNullishOr(byName.get(`graph__${tool}`)));
      const request = { callId: `call-${calls}`, input, ...(room === undefined ? {} : { room }) };
      return offered.call(request, signals ?? controlledSignals());
    },
    close: async () => {
      await opened.close();
      await access.close();
      await fake.close();
    },
  };
}
