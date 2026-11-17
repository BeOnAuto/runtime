import { describe, expect, it } from 'vitest';

import { sectionOf, withMessages, withoutMessages } from './goals-guide-reading.ts';

const renditions = [
  ['with messages', withMessages],
  ['without messages', withoutMessages],
] as const;

describe('the goals guide', () => {
  it.each(renditions)(
    'has the person answer their request in Studio, a window open as its marking run ends, and every sentence a person reads in their words (%s)',
    (_, guide) => {
      expect(sectionOf(guide, '## Before you build anything, learn the goals with the person')).toContain(
        'They can answer any request in Studio, so one held for an agent, `deliver: agent`, asks them there with no connection.',
      );
      expect(guide).toContain('A run marks as it ends, so mark the start in a run that does not wait for the person.');
      expect(sectionOf(guide, '## What a workflow contributes')).toContain(
        'The same holds for `says` and for every question a request puts to the person: dates and times in words in the person\'s time zone, such as "Tuesday, November 17 at 9:20 AM", a name rather than an email address, and no id.',
      );
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'says how a failed run reaches its thing, and when a thing nothing measured is missed (%s)',
    (_, guide) => {
      const contributing = sectionOf(guide, '## What a workflow contributes');

      expect(contributing).toContain(
        'A failed run reaches only a thing marked or measured by a run it follows from, such as the run whose event started it, or, when its workflow contributes to the goal, by a run the same outside event started.',
      );
      expect(contributing).toContain(
        'a run started by its schedule, or one that fails before anything marked the thing, stops nothing.',
      );
      expect(guide).toContain(
        'So tell the person that a thing nothing measured, such as one waiting on an answer that never came, shows overdue once its close and grace pass, and is missed only one window later.',
      );
    },
  );
});
