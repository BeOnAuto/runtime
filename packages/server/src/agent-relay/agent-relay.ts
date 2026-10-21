import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { reportedOnStderr, startingFor, type AgentRelaying } from '../background-start/agent-starting.ts';
import { impatient, runningRuntime } from '../background-start/background-start.ts';
import { runtimeAddressOf } from '../local-runtime/runtime-probe.ts';
import { throughARestart } from '../local-runtime/runtime-restarts.ts';
import { relay } from './mcp-relay.ts';

export async function relayedAgent(port: number, relaying: AgentRelaying): Promise<void> {
  const starting = startingFor(relaying);
  const notRunning = await runningRuntime(port, starting, impatient);
  if (notRunning !== undefined) {
    reportedOnStderr(notRunning);
  }
  await relay({
    agent: () => new StdioServerTransport(),
    runtime: () => new StreamableHTTPClientTransport(new URL(`${runtimeAddressOf(port)}/mcp`)),
    recover: () => runningRuntime(port, starting, throughARestart),
    report: reportedOnStderr,
  });
}
