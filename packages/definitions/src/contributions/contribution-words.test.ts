import { internalTermsIn } from '@on.auto/operations/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { oneOff, textOf } from '../goals/goal-examples.ts';
import { goalsDocumentOf } from '../goals/goals-check.ts';
import { contributionIssuesOf } from './contribution-entries.ts';
import { contributesWantedWords, contributionsMisfitWords, goalsWantedAtSaveWordsOf } from './contribution-words.ts';

describe('the words of the workflow save gate', () => {
  it('fit a detail, name no internal term, and name an unknown goal when every goal is retired', () => {
    const words = [
      goalsWantedAtSaveWordsOf(true),
      goalsWantedAtSaveWordsOf(false),
      contributesWantedWords,
      contributionsMisfitWords,
      ...contributionIssuesOf(Result.getOrThrow(goalsDocumentOf(textOf([{ ...oneOff, retired: true }]))).goals, [
        { goal: 'gone', purpose: 'It counts.' },
      ]).map(({ detail }) => detail),
    ];

    expect(words.at(-1)).toBe('The playbook has no goal gone, and every goal it has is retired');
    for (const detail of words) {
      expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
      expect(internalTermsIn(detail)).toEqual([]);
    }
  });
});
