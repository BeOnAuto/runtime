import {
  answerSection,
  answerSentence,
  answerWaitSentence,
  inboxSentence,
  inputDetails,
  messageLead,
  notTakenSentence,
  notificationSentence,
  paragraph,
  replyDiagram,
  replyRuleSentence,
  replyWaitSentence,
  unansweredSentence,
  whereSection,
  type OverviewBlock,
  type Phrases,
  type ToldParts,
} from '@on.auto/definitions';
import { quotedTemplate } from '@on.auto/definitions/template';
import type { Schema } from 'effect';

import { replyWaitMsOf } from '../conversations/cadence.ts';
import type { RequestDocument } from '../document/interaction-document.ts';
import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';
import { partyOf } from './request-party.ts';

type Words = Readonly<Record<string, readonly string[]>>;

interface ReadReplies {
  readonly route: WrittenRoute;
  readonly replies: Replies;
  readonly reply: ReplyRule;
  readonly answer: Schema.JsonObject;
}

function verdictsOf(reply: ReplyRule): Words | undefined {
  for (const part of Object.values(reply)) {
    if (part.from === 'word') {
      return part.words;
    }
  }
  return undefined;
}

function readRepliesOf({ route, reply, output }: RequestDocument): ReadReplies | undefined {
  const answer = output.schema?.document;
  return route?.replies === undefined || reply === undefined || answer === undefined
    ? undefined
    : { route, replies: route.replies, reply, answer };
}

function readingSentences({ replies, reply, answer }: ReadReplies, expiresMs: number): readonly string[] {
  return [
    replyWaitSentence(expiresMs, replyWaitMsOf(replies)),
    replyRuleSentence(reply, answer),
    ...(verdictsOf(reply) === undefined ? [] : [notTakenSentence(replies.tell !== undefined)]),
    unansweredSentence(expiresMs),
  ];
}

function waitingSentences(document: RequestDocument): readonly string[] {
  const { route, output, expiresMs } = document;
  const read = readRepliesOf(document);
  if (read !== undefined) {
    return readingSentences(read, expiresMs);
  }
  if (output.schema === undefined) {
    return [route === undefined ? inboxSentence('nothing') : notificationSentence];
  }
  return [route === undefined ? inboxSentence('answer') : answerWaitSentence(expiresMs), unansweredSentence(expiresMs)];
}

function diagramOf(document: RequestDocument, party: Phrases): readonly OverviewBlock[] {
  const read = readRepliesOf(document);
  const verdicts = read === undefined ? undefined : verdictsOf(read.reply);
  if (read === undefined || verdicts === undefined) {
    return [];
  }
  return [
    replyDiagram({
      input: document.input.schema?.document,
      party,
      server: read.route.deliver.server,
      expiresMs: document.expiresMs,
      verdicts,
      told: read.replies.tell !== undefined,
    }),
  ];
}

function whereOf({ to, from, route, expires }: RequestDocument): ReturnType<typeof whereSection> {
  const replies = route?.replies;
  return whereSection({
    to: to.text,
    from: from?.text,
    route:
      route === undefined
        ? undefined
        : {
            server: route.deliver.server,
            tool: route.deliver.tool,
            replies: replies === undefined ? undefined : { tool: replies.tool, wait: replies.wait },
          },
    expires,
  });
}

export function requestOverview(document: RequestDocument): ToldParts {
  const input = document.input.schema?.document;
  const answer = document.output.schema?.document;
  const party = partyOf(document.to, input);
  return {
    body: [
      ...diagramOf(document, party),
      messageLead({ input, party, server: document.route?.deliver.server }),
      ...quotedTemplate(document.message, input),
      paragraph(waitingSentences(document).join(' ')),
      ...(answer === undefined ? [] : [answerSentence(answer)]),
    ],
    appendix: [inputDetails(input), answerSection(answer), whereOf(document)],
  };
}
