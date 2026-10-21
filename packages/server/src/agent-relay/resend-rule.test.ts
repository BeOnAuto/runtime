import { stoppedWords } from '@on.auto/api';
import { describe, expect, it } from 'vitest';

import type { Loss } from '../runtime-recovery/runtime-losses.ts';
import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';
import { decisionFor, heldTooLongWords, wordsAfter, type Decision } from './resend-rule.ts';

const safeToRepeat = [
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
];

const check = (mayHaveTakenEffect: string) =>
  `${mayHaveTakenEffect}. Look at the playbook, its definitions and its runs to see whether it did before you send it again.`;

describe('the one rule for sending a request again', () => {
  it.each(['tools/call', ...safeToRepeat])('sends %s again when it never reached the runtime', (method) => {
    expect(decisionFor(method, 'refused')).toEqual({ kind: 'sent again' });
  });

  it.each(['tools/call', 'tools/list'])('never sends %s again when the runtime turned it away', (method) => {
    expect(decisionFor(method, 'turned away')).toEqual({ kind: 'answered with its refusal' });
  });

  it.each(
    safeToRepeat.flatMap((method): readonly (readonly [string, Loss])[] => [
      [method, 'stopped'],
      [method, 'unanswered'],
    ]),
  )(
    'sends %s again after it may have reached the runtime, %s, since doing it twice changes nothing',
    (method, loss) => {
      expect(decisionFor(method, loss)).toEqual({ kind: 'sent again' });
    },
  );

  it.each<readonly [Loss, string]>([
    ['stopped', stoppedWords],
    [
      'unanswered',
      'Auto Runtime stopped answering while it handled this request, so it may or may not have taken effect',
    ],
  ])(
    'never sends a tool call again that may have reached the runtime, %s, and says to check the runs for it',
    (loss, happened) => {
      expect(decisionFor('tools/call', loss)).toEqual({ kind: 'answered with the check', words: check(happened) });
    },
  );
});

const runs: Recovery = { runs: true };

const leftAlone: Recovery = { runs: false, words: 'Auto Runtime did not start on port 5555; its log is runtime.log' };

const tookThePortWords =
  'Another Auto Runtime took port 5555 first, so the one this connection started ended. Send the request again: it goes to the one on the port.';

const tookThePort: Recovery = { runs: false, words: tookThePortWords, anotherAnswers: true };

const sentAgain: Decision = { kind: 'sent again' };

const refusal: Decision = { kind: 'answered with its refusal' };

const checkedWords = check(stoppedWords);

const checked: Decision = { kind: 'answered with the check', words: checkedWords };

const said = 'Auto Runtime turned this request away: The body is too large';

interface Held {
  readonly recovery: Recovery | undefined;
  readonly reached: boolean;
  readonly replacing?: boolean;
  readonly words: string | undefined;
}

describe('the words a request held to be sent again is answered with', () => {
  it.each<Held & { readonly case: string }>([
    {
      case: 'none, so it is sent again, when the runtime runs again',
      recovery: runs,
      reached: false,
      words: undefined,
    },
    {
      case: 'why the runtime does not run, when it could not be made to',
      recovery: leftAlone,
      reached: true,
      words: leftAlone.words,
    },
    {
      case: 'that it was not sent, at the cap, when it never reached the runtime',
      recovery: undefined,
      reached: false,
      words: heldTooLongWords(false, false),
    },
    {
      case: 'that it was not answered, at the cap, when it may have reached it',
      recovery: undefined,
      reached: true,
      words: heldTooLongWords(true, false),
    },
    {
      case: 'that the runtime is being started again, at the cap, while a frozen one is replaced',
      recovery: undefined,
      reached: true,
      replacing: true,
      words: heldTooLongWords(true, true),
    },
    {
      case: 'none, so it is sent to the runtime on the port, when another runtime took the port first',
      recovery: tookThePort,
      reached: false,
      words: undefined,
    },
  ])('are $case', ({ recovery, reached, replacing = false, words }) => {
    expect(wordsAfter(sentAgain, recovery, { reached, said, replacing })).toBe(words);
  });
});

describe('the words a request the runtime turned away is answered with', () => {
  it.each<Held & { readonly case: string }>([
    { case: 'what the runtime said, when it still runs', recovery: runs, reached: true, words: said },
    {
      case: 'why the runtime does not run, when it stopped since',
      recovery: leftAlone,
      reached: true,
      words: leftAlone.words,
    },
    { case: 'what the runtime said, at the cap', recovery: undefined, reached: true, words: said },
  ])('are $case', ({ recovery, reached, replacing = false, words }) => {
    expect(wordsAfter(refusal, recovery, { reached, said, replacing })).toBe(words);
  });
});

describe('the words a call that may have taken effect is answered with', () => {
  it.each<Held & { readonly case: string }>([
    {
      case: 'the check, and that the runtime runs again',
      recovery: runs,
      reached: true,
      words: `${checkedWords} Auto Runtime runs again.`,
    },
    {
      case: 'the check, and why the runtime does not run',
      recovery: leftAlone,
      reached: true,
      words: `${checkedWords} ${leftAlone.words}`,
    },
    {
      case: 'the check, and that the runtime is still being started, at the cap',
      recovery: undefined,
      reached: true,
      words: `${checkedWords} Auto Runtime is still being started.`,
    },
    {
      case: 'the check, and that the runtime is being started again, at the cap, while a frozen one is replaced',
      recovery: undefined,
      reached: true,
      replacing: true,
      words: `${checkedWords} Auto Runtime is being started again.`,
    },
    {
      case: 'the check, and that another runtime took the port first',
      recovery: tookThePort,
      reached: true,
      words: `${checkedWords} ${tookThePortWords}`,
    },
  ])('are $case', ({ recovery, reached, replacing = false, words }) => {
    expect(wordsAfter(checked, recovery, { reached, said, replacing })).toBe(words);
  });
});

describe('the words for a request held past the cap', () => {
  it('say whether it was sent, whether a frozen runtime is being replaced, and to send it again in a few seconds', () => {
    expect([heldTooLongWords(false, false), heldTooLongWords(true, false), heldTooLongWords(true, true)]).toEqual([
      'Auto Runtime is still being started, so this request was not sent. Send it again in a few seconds.',
      'Auto Runtime is still being started, so this request was not answered. Send it again in a few seconds.',
      'Auto Runtime is being started again, so this request was not answered. Send it again in a few seconds.',
    ]);
  });
});
