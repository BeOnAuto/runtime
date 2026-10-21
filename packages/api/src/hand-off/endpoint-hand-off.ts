import type { McpHttpHandler } from '@modelcontextprotocol/server';

import { AnswersAtStop, requestIdsIn } from '../answer-streams/answers-at-stop.ts';
import { serverStopping } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';
import { authInfoFor, type OrgCall, type PlaybookCall } from './caller-hand-off.ts';
import { droppedArgumentsIn, postedMessagesOf } from './dropped-arguments.ts';

type HandedCall = Omit<OrgCall, 'dropped'> | Omit<PlaybookCall, 'dropped'>;

export type HandOff = (request: Request, call: HandedCall) => Promise<Response>;

export class EndpointHandOffs {
  readonly #answers = new AnswersAtStop();

  to(fetchMcp: McpHttpHandler['fetch']): HandOff {
    return async (request, call) => {
      const messages = await postedMessagesOf(request);
      if (this.#answers.hasStopped()) {
        return problemResponse(serverStopping);
      }
      const dropped = droppedArgumentsIn(messages);
      const answer = await fetchMcp(request, { authInfo: authInfoFor({ ...call, dropped }) });
      return this.#answers.answering(requestIdsIn(messages), answer);
    };
  }

  stop(): void {
    this.#answers.stop();
  }
}
