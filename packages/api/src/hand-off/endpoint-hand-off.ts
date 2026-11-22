import type { McpHttpHandler } from '@modelcontextprotocol/server';

import { AnswersAtStop, requestIdsIn } from '../answer-streams/answers-at-stop.ts';
import type { GuideShelf } from '../guides/guide-shelf.ts';
import type { EveryTool } from '../mcp/mcp-connection.ts';
import { serverStopping } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';
import { authInfoFor, type OrgCall, type PlaybookCall } from './caller-hand-off.ts';
import { droppedArgumentsIn, postedOf } from './dropped-arguments.ts';
import { mcpRequestNoted, notedMcpCall } from './mcp-calls-noted.ts';
import { mcpNamesOf } from './mcp-names.ts';

type HandedCall = Omit<OrgCall, 'dropped'> | Omit<PlaybookCall, 'dropped'>;

export type HandOff = (request: Request, call: HandedCall) => Promise<Response>;

export class EndpointHandOffs {
  readonly #answers = new AnswersAtStop();

  to(fetchMcp: McpHttpHandler['fetch'], shelf: GuideShelf, every: EveryTool): HandOff {
    const names = mcpNamesOf(shelf, every);
    return async (request, call) => {
      const { messages, bytes } = await postedOf(request);
      if (this.#answers.hasStopped()) {
        return problemResponse(serverStopping);
      }
      const noting = notedMcpCall(mcpRequestNoted(messages, bytes, names));
      const dropped = droppedArgumentsIn(messages);
      const answer = await fetchMcp(request, { authInfo: authInfoFor({ ...call, dropped }) });
      return this.#answers.answering(requestIdsIn(messages), answer, noting);
    };
  }

  stop(): void {
    this.#answers.stop();
  }
}
