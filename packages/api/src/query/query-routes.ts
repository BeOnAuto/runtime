import { rejected, type Catalog, type Dispatcher, type DispatcherServices, type Outcome } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { AppRuntime } from '../app-runtime.ts';
import { callerOfAnotherOrg } from '../authentication/challenges.ts';
import { problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes } from '../routes.ts';
import { queryAnswered, queryServingOf, type QueryServed } from './query-answers.ts';
import { readsDispatchedEach, type ReadsTogetherOf } from './query-reads.ts';
import { queryAskedIn } from './query-request.ts';
import { queryPath, schemaServed } from './schema-route.ts';

export interface QueryRoutesOptions extends QueryServed {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly run: AppRuntime<DispatcherServices>['run'];
  readonly together?: ReadsTogetherOf;
}

const stoppedBeforeReading = rejected('unavailable', 'The server stopped before the read was answered');

export function queryRoutes({
  catalog,
  dispatcher,
  run,
  together = readsDispatchedEach,
  edges,
  limits,
}: QueryRoutesOptions): RegisterRoutes {
  const serving = queryServingOf(catalog, edges, limits);
  return (routes) => {
    schemaServed(routes, serving.schema.text);
    routes.add('POST', queryPath, async (c) => {
      const org = String(c.req.param('org'));
      const caller = c.get('principal').callerIn(org);
      if (caller === undefined) {
        return problemResponse(callerOfAnotherOrg);
      }
      const asked = await queryAskedIn(c.req.raw);
      if (Result.isFailure(asked)) {
        return problemResponse(asked.failure);
      }
      const reads = together(dispatcher, { caller, org });
      const context = routes.callContext(c.req.raw);
      const { status, body } = await queryAnswered(serving, asked.success, (each) => {
        const resolvers: ((outcome: Outcome) => void)[] = [];
        const answers = each.map(
          (_, at) =>
            new Promise<Outcome>((resolve) => {
              resolvers[at] = resolve;
            }),
        );
        const unanswered = () => {
          for (const resolve of resolvers) resolve(stoppedBeforeReading);
        };
        void run(
          reads(each, (at, outcome) => {
            resolvers[at]?.(outcome);
          }).pipe(Effect.provideContext(context), Effect.annotateLogs({ requestId: c.get('requestId') })),
          c.req.raw.signal,
        ).then(unanswered, unanswered);
        return answers;
      });
      return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
    });
  };
}
