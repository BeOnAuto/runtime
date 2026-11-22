import { describe, expect, it } from 'vitest';

import {
  COMMENT_LINES,
  CONFIRMATION_LINES,
  CONVERSATION_LINES,
  instructionsToldTo,
  ROLE_LINES,
  ROLE_REFUSAL_LINES,
  type ToldOfTheRole,
} from './conversation-instructions.ts';

const SURFACE_LINES: readonly string[] = ['The lines of the service the turn is answered in.', 'And a second.'];

const toldOf = (role: ToldOfTheRole) =>
  instructionsToldTo('You act for Pat.', { surfaceLines: SURFACE_LINES, ...role });

const linesOf = (...lines: readonly (readonly string[])[]) =>
  `You act for Pat.\n\n${[...CONVERSATION_LINES, ...lines.flat(), ...SURFACE_LINES].join(' ')}`;

describe('what the model is told beside the instructions of the directory', () => {
  it('is the fixed lines after the instructions, and the lines of the service it is answered in only where it is given them', () => {
    const plain = instructionsToldTo('You act for Pat.');
    expect(plain).toBe(`You act for Pat.\n\n${CONVERSATION_LINES.join(' ')}`);
    expect(instructionsToldTo('You act for Pat.', { surfaceLines: SURFACE_LINES })).toBe(
      `You act for Pat.\n\n${[...CONVERSATION_LINES, ...SURFACE_LINES].join(' ')}`,
    );
    expect(instructionsToldTo('You act for Pat.', { surfaceLines: undefined })).toBe(plain);
  });

  it('asks the person first before a tool that deletes, retires, removes, cancels, disconnects, invites or starts a run, only for a turn that began with a reply that did not name Auto', () => {
    const plain = instructionsToldTo('You act for Pat.', { surfaceLines: SURFACE_LINES });
    const unnamed = instructionsToldTo('You act for Pat.', { surfaceLines: SURFACE_LINES, autoNotNamed: true });
    expect(unnamed).toBe(`${plain} ${CONFIRMATION_LINES.join(' ')}`);
    expect(instructionsToldTo('You act for Pat.', { surfaceLines: SURFACE_LINES, autoNotNamed: false })).toBe(plain);
  });

  it('says, only for a person whose role allows no change, that it allows none, that they can still comment only where they may, and what to tell them when they ask for a change', () => {
    const plain = toldOf({});
    expect(toldOf({ roleAllowsNoChange: true, mayComment: true })).toBe(
      linesOf(ROLE_LINES, COMMENT_LINES, ROLE_REFUSAL_LINES),
    );
    expect(toldOf({ roleAllowsNoChange: true, mayComment: false })).toBe(linesOf(ROLE_LINES, ROLE_REFUSAL_LINES));
    expect(toldOf({ roleAllowsNoChange: true })).toBe(linesOf(ROLE_LINES, ROLE_REFUSAL_LINES));
    expect([
      toldOf({ roleAllowsNoChange: false }),
      toldOf({ roleAllowsNoChange: false, mayComment: true }),
      toldOf({ mayComment: true }),
    ]).toEqual([plain, plain, plain]);
    expect(plain).toBe(linesOf());
  });
});
