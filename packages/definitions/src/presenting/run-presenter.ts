import {
  strictRecordedDecoder,
  type KeptContent,
  type PresentedFact,
  type Presenter,
  type RecordedFact,
} from '@on.auto/operations';
import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '@on.auto/tool-servers';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import {
  cancelAsked,
  requestAnswered,
  runBrokeDown,
  runFinished,
  runRejected,
  runStarted,
  toolAnswered,
  toolCalled,
  toolFailed,
} from '../plain-language/event-words.ts';
import type { DeclaredFact } from '../run-work/declared-facts.ts';
import { deferralAccount } from '../run-work/run-work-accounts.ts';
import {
  RunEventSchema,
  coreRunFactTypes,
  isRunEndingType,
  type RecordedRunEvent,
  type RecordedRunFact,
  type RunEvent,
} from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { cutAtCodePoint, issuesShown, mostDetailBytes, mostNameBytes } from './event-data.ts';

type Shown<Type extends RunEvent['type']> = RecordedRunFact<Type>;

type ToolCallShown = Shown<'tool_call_started' | 'tool_call_answered' | 'tool_call_failed'>;

function rejectionShown(rejection: RunRejection) {
  const detail = cutAtCodePoint(rejection.detail, mostDetailBytes);
  if (rejection.reason === 'invalid_input') {
    const { reason, kind, issues } = rejection;
    return { reason, detail, ...(kind === undefined ? {} : { kind }), ...issuesShown(issues) };
  }
  if (rejection.reason === 'cancelled' || rejection.reason === 'unanswered') {
    const { reason, kind } = rejection;
    return { reason, detail, kind };
  }
  const { reason, kind, because } = rejection;
  return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
}

function toolCallFact(event: ToolCallShown, content: KeptContent): PresentedFact {
  if (event.type === 'tool_call_started') {
    const { data } = event;
    const server = named(data.server);
    const tool = named(data.tool);
    return {
      type: event.type,
      summary: toolCalled(data.number, server, tool),
      data: { ...callFieldsShown(data), ...keptArgumentsOf(data, content) },
    };
  }
  if (event.type === 'tool_call_answered') {
    const { data } = event;
    return {
      type: event.type,
      summary: toolAnswered(data.number, data.is_error),
      data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
    };
  }
  const { data } = event;
  return { type: event.type, summary: toolFailed(data.number, data.because), data: callFieldsShown(data) };
}

function startFact(words: DefinitionWords, { type, data, context }: Shown<'run_started'>): PresentedFact {
  const { definitionType, definitionName, trigger } = context;
  return { type, summary: runStarted(words, definitionType, definitionName, trigger), data };
}

function cancelFact({ type, data }: Shown<'run_cancel_requested'>): PresentedFact {
  return {
    type,
    summary: cancelAsked(data.kind),
    data: { ...data, reason: cutAtCodePoint(data.reason, mostDetailBytes) },
  };
}

function answerFact({ type, data }: Shown<'request_answered'>): PresentedFact {
  const { answer, claimed_for: claimedFor, reply } = data;
  return {
    type,
    summary: requestAnswered(reply !== undefined),
    data: {
      answer,
      ...(claimedFor === undefined ? {} : { claimed_for: named(claimedFor) }),
      ...(reply === undefined ? {} : { reply: { id: named(reply.id), sender: named(reply.sender) } }),
    },
  };
}

function endingFact(event: Shown<'run_succeeded' | 'run_rejected' | 'run_failed'>): PresentedFact {
  if (event.type === 'run_succeeded') {
    return { type: event.type, summary: runFinished, data: event.data };
  }
  if (event.type === 'run_rejected') {
    const { rejection, record } = event.data;
    const data = { ...rejectionShown(rejection), ...(record === undefined ? {} : { record }) };
    return { type: event.type, summary: runRejected(rejection), data };
  }
  const { incident } = event.data;
  return { type: event.type, summary: runBrokeDown, data: incident === undefined ? {} : { incident: named(incident) } };
}

const toolCallTypes: ReadonlySet<string> = new Set(['tool_call_started', 'tool_call_answered', 'tool_call_failed']);

function isToolCall(event: RecordedRunEvent): event is ToolCallShown {
  return toolCallTypes.has(event.type);
}

function isEnding(event: RecordedRunEvent): event is Shown<'run_succeeded' | 'run_rejected' | 'run_failed'> {
  return isRunEndingType(event.type);
}

type CoreShown = Exclude<RecordedRunEvent, Shown<'work'>>;

function coreFactOf(words: DefinitionWords, event: CoreShown, content: KeptContent): PresentedFact | undefined {
  if (event.type === 'run_deferred') {
    return deferralAccount(words.runWordsOf(event.context.definitionType), event.data);
  }
  if (isToolCall(event)) {
    return toolCallFact(event, content);
  }
  if (event.type === 'run_started') {
    return startFact(words, event);
  }
  if (event.type === 'run_cancel_requested') {
    return cancelFact(event);
  }
  return isEnding(event) ? endingFact(event) : answerFact(event);
}

const decodeRunEvent = strictRecordedDecoder(RunEventSchema);

function presentedBy(words: DefinitionWords, declared: readonly DeclaredFact[]) {
  const byType = new Map(declared.map((fact) => [fact.type, fact]));
  return (recorded: RecordedFact, content: KeptContent): PresentedFact | undefined => {
    const event = decodeRunEvent(recorded);
    return event.type === 'work'
      ? byType.get(recorded.type)?.present(recorded, content)
      : coreFactOf(words, event, content);
  };
}

function shownNamesOf(declared: readonly DeclaredFact[]): Readonly<Record<string, readonly string[]>> {
  const shown = [...coreRunFactTypes.filter((type) => type !== 'run_deferred'), ...declared.map(({ type }) => type)];
  return Object.fromEntries(shown.map((type) => [type, [type]]));
}

export function runPresenter(words: DefinitionWords, declared: readonly DeclaredFact[]): Presenter {
  const present = presentedBy(words, declared);
  return {
    streamKind: 'runs',
    publicNames: { ...shownNamesOf(declared), run_deferred: words.deferralTypes },
    present: (recorded, content) => {
      const fact = present(recorded, content);
      return fact === undefined ? [] : [fact];
    },
  };
}
