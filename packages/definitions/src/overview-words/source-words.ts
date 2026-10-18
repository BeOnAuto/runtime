import { paragraph, type Paragraph, type Phrases } from '../overview/overview.ts';

type Shown = 'program' | 'value';

const endings: Readonly<Record<Shown, string>> = {
  program: ' is TypeScript and is shown under Source.',
  value: ', shown under Source.',
};

export function shownUnderSource(shown: Shown, ...said: Phrases): Paragraph {
  return paragraph(...said, endings[shown]);
}
