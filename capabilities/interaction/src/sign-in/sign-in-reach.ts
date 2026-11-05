import type { RunContext } from '@on.auto/definitions';
import { RunUnanswered, isAPerson, personOfTheOrg, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { SignInDocument, SignInSite } from '../document/interaction-document.ts';
import { offered, type InteractionPorts } from '../run/request-reach.ts';
import { routeOf, toolsOf } from '../tool-blocks/routes.ts';
import { signInTool } from './sign-in-schemas.ts';
import { noPersonWords } from './sign-in-words.ts';

type ActingRun = Pick<RunContext, 'org' | 'playbook' | 'caller' | 'actsFor'>;

function namedPersonOf({ caller, actsFor }: ActingRun): string | undefined {
  return isAPerson(caller.id) ? caller.id : actsFor;
}

function personAsked(run: ActingRun, site: SignInSite): Effect.Effect<string, RunUnanswered> {
  const named = namedPersonOf(run);
  if (named === undefined) {
    return Effect.fail(new RunUnanswered({ detail: noPersonWords(site), kind: 'no_person' }));
  }
  return Effect.flatMap(personOfTheOrg(run.org, named), (person) =>
    person === undefined
      ? Effect.fail(new RunUnanswered({ detail: noPersonWords(site, named), kind: 'no_person' }))
      : Effect.succeed(person),
  );
}

function deliveryOf({ whenSignedOut }: SignInDocument) {
  return whenSignedOut.answer === 'ask' ? whenSignedOut.asking.route : undefined;
}

export function reachedPerson(
  ports: InteractionPorts,
  run: ActingRun,
  document: SignInDocument,
): Effect.Effect<string, RunUnanswered | Unavailable> {
  return Effect.flatMap(personAsked(run, document.signIn), (person) =>
    Effect.as(
      offered(
        [{ server: document.signIn.server, tool: signInTool }, ...toolsOf(routeOf(deliveryOf(document) ?? {}))],
        ports,
        { org: run.org, playbook: run.playbook },
      ),
      person,
    ),
  );
}
