import { guideShelfOf, type DefinitionType, type Guide, type Recipe } from '../index.ts';

export const notebookGuide: Guide = {
  name: 'notebook',
  title: 'Notebook',
  description: 'How a note is written.',
  text: '# Notebook\n\nA note has a name of lowercase letters, digits and hyphens, and a text.\n',
};

export const wordsGuide: Guide = {
  name: 'terminology',
  title: 'Terminology',
  description: 'What the words of the notebook mean.',
  text: '# Terminology\n\nA note is one thing to remember.\n',
};

export const noteRecipe: Recipe = {
  name: 'take-a-note',
  title: 'Take a note',
  description: 'Adds a note the person dictates.',
  text: '# Take a note\n\n1. Ask the person what the note says.\n2. Add it with add_note.\n',
  arguments: [
    { name: 'text', description: 'What the note says', required: true },
    { name: 'name', description: 'The name of the note', required: false },
  ],
  formatGuide: 'notebook',
  calls: ['add_note'],
  request: ({ text, name }) =>
    name === undefined ? `Take a note that says ${String(text)}.` : `Take the note ${name}: ${String(text)}.`,
};

export const testGuides: readonly Guide[] = [wordsGuide, notebookGuide];

export const testRecipes: readonly Recipe[] = [noteRecipe];

export const testDefinitionTypes: readonly DefinitionType[] = [{ type: 'notes', noun: 'note', guide: 'notebook' }];

export const testShelf = guideShelfOf(testGuides, testRecipes, testDefinitionTypes);
