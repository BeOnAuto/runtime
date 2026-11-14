import { describe, expect, it } from 'vitest';

import { packageWithTexts, subjectOf, textsOfPackage, type PortableText } from './package-texts.ts';
import type { PortablePackage } from './portable-package.ts';

const written: PortablePackage = {
  format: 1,
  goals: 'goals text',
  page: 'page text',
  definitions: [
    {
      type: 'lookup',
      name: 'read',
      source: 'read source',
      overview: 'read overview',
      diagram: 'read diagram',
      paused: false,
    },
    { type: 'workflow', name: 'flow', source: 'flow source', paused: true },
  ],
};

describe('the texts of a package', () => {
  it('are its goals, its page and each definition source, overview and diagram, each with its place', () => {
    expect(textsOfPackage(written)).toEqual([
      { part: 'goals', text: 'goals text' },
      { part: 'page', text: 'page text' },
      { part: 'definition', name: 'lookup/read', field: 'source', text: 'read source' },
      { part: 'definition', name: 'lookup/read', field: 'overview', text: 'read overview' },
      { part: 'definition', name: 'lookup/read', field: 'diagram', text: 'read diagram' },
      { part: 'definition', name: 'workflow/flow', field: 'source', text: 'flow source' },
    ]);
    expect(textsOfPackage({ format: 1, definitions: [] })).toEqual([]);
  });

  it('name a definition by its type and name', () => {
    expect(subjectOf({ type: 'lookup', name: 'read' })).toBe('lookup/read');
  });

  it('are put back where they came from, leaving a text not given as it was', () => {
    const texts = textsOfPackage(written).map((text: PortableText) =>
      Object.assign({}, text, { text: `${text.text}!` }),
    );
    expect(packageWithTexts(written, texts)).toEqual({
      format: 1,
      goals: 'goals text!',
      page: 'page text!',
      definitions: [
        {
          type: 'lookup',
          name: 'read',
          source: 'read source!',
          overview: 'read overview!',
          diagram: 'read diagram!',
          paused: false,
        },
        { type: 'workflow', name: 'flow', source: 'flow source!', paused: true },
      ],
    });
    expect(packageWithTexts(written, [])).toEqual(written);
    expect(packageWithTexts({ format: 1, definitions: [] }, texts)).toEqual({ format: 1, definitions: [] });
  });
});
