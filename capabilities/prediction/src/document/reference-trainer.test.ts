import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mostNoteBytes } from '../build/build-request.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { modelDeadlines } from '../model-processes/model-processes.ts';
import { mostCardBytes } from '../scoring/version-card.ts';

const page = readFileSync(new URL('../../../../docs/reference/prediction-format.md', import.meta.url), 'utf8');

const mebibyte = 1_048_576;

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the bounds on the reference page of the trainer of a build', () => {
  it('are the bounds the code holds a candidate, an answer and a card to', () => {
    expect([
      valueOf('Candidates of a build'),
      valueOf("A candidate's check"),
      valueOf("A candidate's scoring"),
      valueOf('A recipe, a limitation'),
      valueOf("A version's card"),
    ]).toEqual([
      expect.stringContaining(
        `${predictionBounds.candidatesInABuild}, each a file of at most ${predictionBounds.mostCandidateBytes / mebibyte} MiB`,
      ),
      expect.stringContaining(`${modelDeadlines.check / 1000} seconds`),
      expect.stringContaining(`${modelDeadlines.walk / 60_000} minutes`),
      expect.stringContaining(`${mostNoteBytes / 1024} KiB`),
      expect.stringContaining(`${mostCardBytes / 1024} KiB`),
    ]);
  });
});
