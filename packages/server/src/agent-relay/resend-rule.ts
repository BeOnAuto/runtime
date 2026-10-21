import { stoppedWords } from '@on.auto/api';

import type { Loss } from '../runtime-recovery/runtime-losses.ts';
import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';

export type Decision =
  | { readonly kind: 'sent again' }
  | { readonly kind: 'answered with its refusal' }
  | { readonly kind: 'answered with the check'; readonly words: string };

export interface Holding {
  readonly reached: boolean;
  readonly said: string;
}

const safeToRepeat: ReadonlySet<string> = new Set([
  'initialize',
  'ping',
  'server/discover',
  'tools/list',
  'prompts/list',
  'prompts/get',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'completion/complete',
]);

const stillBeingStarted = 'Auto Runtime is still being started';

const runsAgain = 'Auto Runtime runs again.';

function checkWords(mayHaveTakenEffect: string): string {
  return `${mayHaveTakenEffect}. Look at the playbook, its definitions and its runs to see whether it did before you send it again.`;
}

const sentAgain: Decision = { kind: 'sent again' };

const answeredWithItsRefusal: Decision = { kind: 'answered with its refusal' };

function sentAgainIfSafe(mayHaveTakenEffect: string): (method: string) => Decision {
  const checked: Decision = { kind: 'answered with the check', words: checkWords(mayHaveTakenEffect) };
  return (method) => (safeToRepeat.has(method) ? sentAgain : checked);
}

const decisions: Readonly<Record<Loss, (method: string) => Decision>> = {
  refused: () => sentAgain,
  'turned away': () => answeredWithItsRefusal,
  stopped: sentAgainIfSafe(stoppedWords),
  unanswered: sentAgainIfSafe(
    'Auto Runtime stopped answering while it handled this request, so it may or may not have taken effect',
  ),
};

export function decisionFor(method: string, loss: Loss): Decision {
  return decisions[loss](method);
}

export function heldTooLongWords(reached: boolean): string {
  return `${stillBeingStarted}, so this request was not ${reached ? 'answered' : 'sent'}. Send it again in a few seconds.`;
}

function outcomeWords(recovery: Recovery | undefined): string {
  if (recovery === undefined) {
    return `${stillBeingStarted}.`;
  }
  return recovery.runs ? runsAgain : recovery.words;
}

function sentAgainUnless(recovery: Recovery | undefined, reached: boolean): string | undefined {
  if (recovery === undefined) {
    return heldTooLongWords(reached);
  }
  return recovery.runs ? undefined : recovery.words;
}

function refusalAfter(recovery: Recovery | undefined, said: string): string {
  return recovery === undefined || recovery.runs ? said : recovery.words;
}

export function wordsAfter(decision: Decision, recovery: Recovery | undefined, holding: Holding): string | undefined {
  if (decision.kind === 'answered with the check') {
    return `${decision.words} ${outcomeWords(recovery)}`;
  }
  return decision.kind === 'sent again'
    ? sentAgainUnless(recovery, holding.reached)
    : refusalAfter(recovery, holding.said);
}
