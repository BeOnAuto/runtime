import { rejected, unsuccessfulWords } from '@on.auto/operations';
import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { goalsWanted, goalsWantedWordsOf, searchLeadWhereGoalsAreKeptOf } from '../index.ts';
import { askedBeforeMakingWordsOf, goalsStandingOf } from './goals-words.ts';

const encoder = new TextEncoder();

describe('the refusal of a playbook with no goals', () => {
  it("leads with the person's question and says where the answer goes", () => {
    expect(goalsWantedWordsOf(true)).toBe(
      'Ask the person: What should this playbook achieve for you, and how will you know it worked? Ask too what to tell them, and where. Once they say yes, send it as the goals argument of update_playbook or create_playbook, as the goals guide says.',
    );
  });

  it('asks nothing about being told where messages are off, here and wherever an agent is told what to learn first', () => {
    expect([
      goalsWantedWordsOf(false),
      askedBeforeMakingWordsOf(false),
      searchLeadWhereGoalsAreKeptOf(false),
      goalsStandingOf([{ kind: 'no_goal', detail: '', fixed_by: 'person', ask: '' }], false),
    ]).toEqual([
      'Ask the person: What should this playbook achieve for you, and how will you know it worked? Once they say yes, send it as the goals argument of update_playbook or create_playbook, as the goals guide says.',
      'Before you make anything for the person, ask what it should achieve for them and how they will know it worked, as the goals guide says.',
      'To do work for the person here, read the guide start with get_guide, and before you make anything ask them what it should achieve for them and how they will know it worked. ',
      ' It has no goals yet. Ask the person: What should this playbook achieve for you, and how will you know it worked? Once they say yes, send it as the goals argument of update_playbook, as the goals guide says.',
    ]);
    expect(askedBeforeMakingWordsOf(true)).toContain('and what they want to be told and where');
    expect(searchLeadWhereGoalsAreKeptOf(true)).toContain('and what they want to be told and where');
  });

  it('keeps the shape of an issue, in at most 256 bytes and with none of the internal terms', () => {
    const refusal = goalsWanted('/goals', true);

    expect(refusal).toMatchObject({
      _tag: 'invalid_input',
      detail: goalsWantedWordsOf(true),
      issues: [{ pointer: '/goals', detail: goalsWantedWordsOf(true) }],
    });
    expect(encoder.encode(refusal.detail).length).toBeLessThanOrEqual(256);
    expect(internalTermsIn(refusal.detail)).toEqual([]);
  });

  it("puts the person's question first in the words an agent reads, before why it was refused", () => {
    const { detail } = goalsWanted('/goals', false);

    expect(unsuccessfulWords('create the playbook “alpha”', 'command', rejected('invalid_input', detail))).toMatch(
      /^Ask the person: What should this playbook achieve for you, and how will you know it worked\? .* Could not create the playbook “alpha”: /u,
    );
  });
});
