import type { RunContext } from '@on.auto/definitions';
import { unsentCallRefusal, unworkable } from '@on.auto/definitions/tool-blocks';
import { Conflict, Unavailable, holdsNoForbiddenCharacter } from '@on.auto/operations';
import { capitalized } from '@on.auto/phrasing';
import { answerDocument, toolBounds, toolInWords, type AnsweredOnce, type ToolAccess } from '@on.auto/tool-servers';
import { runIdKey } from '@on.auto/tool-servers/policy';
import { Effect, Option, Schema } from 'effect';

import type { SignInSite } from '../document/interaction-document.ts';
import { signInTool } from './sign-in-schemas.ts';
import { noLinkWords } from './sign-in-words.ts';

type SignInAnswer = { readonly signedIn: true } | { readonly signedIn: false; readonly link?: string };

type SignInArguments =
  | { readonly site: string; readonly ask: false }
  | { readonly site: string; readonly request: string; readonly until: string };

type SignInEnding = Effect.Effect<SignInAnswer, Unavailable | Conflict>;

const AnswerSchema = Schema.Union([
  Schema.Struct({ signed_in: Schema.Literal(true) }),
  Schema.Struct({ signed_in: Schema.Literal(false), link: Schema.optionalKey(Schema.String) }),
]);

const decodeAnswer = Schema.decodeUnknownOption(AnswerSchema);

const linkProtocols: ReadonlySet<string> = new Set(['https:', 'http:']);

function isLink(link: string): boolean {
  return URL.canParse(link) && linkProtocols.has(new URL(link).protocol) && holdsNoForbiddenCharacter(link);
}

function namedOf(site: SignInSite): string {
  return toolInWords({ server: site.server, tool: signInTool });
}

function unusable(site: SignInSite, detail: string): SignInEnding {
  return Effect.fail(unworkable('/sign_in', `${capitalized(namedOf(site))} ${detail}`));
}

function answerRead(site: SignInSite, answer: Extract<AnsweredOnce, { readonly outcome: 'result' }>): SignInEnding {
  const read = decodeAnswer(answerDocument(answer.answer));
  if (Option.isNone(read)) {
    return unusable(
      site,
      'answered neither { "signed_in": true }, { "signed_in": false } nor a link where the person signs in',
    );
  }
  if (read.value.signed_in) {
    return Effect.succeed({ signedIn: true });
  }
  const { link } = read.value;
  if (link === undefined) {
    return Effect.succeed({ signedIn: false });
  }
  return isLink(link)
    ? Effect.succeed({ signedIn: false, link })
    : unusable(site, 'answered a link that is not an http or https address');
}

function unfinished(called: AnsweredOnce, because: 'tool_error' | 'server_failed', detail: string): SignInEnding {
  return Effect.fail(
    new Unavailable({
      detail,
      kind: 'tools_unfinished',
      because,
      ...(called.retryAfterMs === null ? {} : { record: { retry_after_ms: called.retryAfterMs } }),
    }),
  );
}

function endedWith(site: SignInSite, called: AnsweredOnce): SignInEnding {
  const named = capitalized(namedOf(site));
  if (called.outcome === 'result') {
    return answerRead(site, called);
  }
  if (called.outcome === 'arguments_refused') {
    return Effect.fail(
      new Conflict({ detail: `${named} refused the arguments: ${called.detail}`, kind: 'unworkable' }),
    );
  }
  return called.outcome === 'tool_error'
    ? unfinished(called, 'tool_error', `${named} answered an error: ${called.detail}`)
    : unfinished(
        called,
        'server_failed',
        `The tool server ${site.server} failed: ${called.detail}, after the run called ${namedOf(site)}`,
      );
}

type SignInCalls = Pick<ToolAccess, 'callOnce'>;

function signInCalled(tools: SignInCalls, site: SignInSite, input: SignInArguments, context: RunContext): SignInEnding {
  return Effect.flatMap(
    tools.callOnce(
      {
        org: context.org,
        playbook: context.playbook,
        reference: { server: site.server, tool: signInTool },
        input,
        meta: { [runIdKey]: context.id },
        longestRetryWaitMs: toolBounds.longestRetryWaitMs,
      },
      { callId: context.id, journal: context.journal },
    ),
    (called) => (called.kind === 'unopened' ? Effect.fail(unsentCallRefusal(called)) : endedWith(site, called)),
  );
}

type Asking = Extract<SignInArguments, { readonly request: string }>;

type AskedAnswer = { readonly signedIn: true } | { readonly signedIn: false; readonly link: string };

export function signInAsked(
  tools: SignInCalls,
  site: SignInSite,
  asking: Asking,
  context: RunContext,
): Effect.Effect<AskedAnswer, Unavailable | Conflict> {
  return Effect.flatMap(signInCalled(tools, site, asking, context), (answer): Effect.Effect<AskedAnswer, Conflict> => {
    if (answer.signedIn) {
      return Effect.succeed(answer);
    }
    return answer.link === undefined
      ? Effect.fail(unworkable('/sign_in', noLinkWords(site)))
      : Effect.succeed({ signedIn: false, link: answer.link });
  });
}

export function signedInNow(
  tools: SignInCalls,
  site: SignInSite,
  context: RunContext,
): Effect.Effect<boolean, Unavailable | Conflict> {
  return Effect.map(signInCalled(tools, site, { site: site.site, ask: false }, context), ({ signedIn }) => signedIn);
}
