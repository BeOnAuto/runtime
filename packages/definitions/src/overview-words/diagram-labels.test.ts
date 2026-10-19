import { describe, expect, it } from 'vitest';

import { charactersIn } from '../index.ts';
import { diagramLabel, mostDiagramLabelCharacters } from './diagram-labels.ts';

describe('the label of a node or an edge of a diagram', () => {
  it(`is its words up to ${mostDiagramLabelCharacters} characters, and past them cut with an ellipsis within the bound`, () => {
    const fits = 'w'.repeat(mostDiagramLabelCharacters);
    const cut = diagramLabel(`${'word '.repeat(11)}and  more`);

    expect([diagramLabel(fits), cut, diagramLabel(`${'🎉'.repeat(mostDiagramLabelCharacters)}!`)]).toEqual([
      fits,
      `${'word '.repeat(11)}and…`,
      `${'🎉'.repeat(mostDiagramLabelCharacters - 1)}…`,
    ]);
    expect(charactersIn(cut)).toBeLessThanOrEqual(mostDiagramLabelCharacters);
  });
});
