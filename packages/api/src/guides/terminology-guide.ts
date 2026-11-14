import type { Guide } from './guide-shelf.ts';

interface Row {
  readonly term: string;
  readonly meaning: string;
}

type Table = readonly Row[];

interface Section {
  readonly heading: string;
  readonly tables: readonly Table[];
}

const separatorRow = /^\|[\s|:-]+\|$/u;

function rowOf(line: string): Row {
  const [term, meaning] = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  return { term: String(term), meaning: String(meaning) };
}

function tablesOf(text: string): readonly Table[] {
  return text
    .split(/\n\s*\n/u)
    .map((block) => block.trim().split('\n'))
    .filter((lines: readonly string[]) => lines.every((line) => line.startsWith('|')))
    .map((lines: readonly string[]) =>
      lines
        .filter((line) => !separatorRow.test(line))
        .slice(1)
        .map((line) => rowOf(line)),
    );
}

function sectionsOf(page: string): readonly Section[] {
  return page
    .split(/^## /mu)
    .slice(1)
    .map((section) => ({ heading: section.slice(0, section.indexOf('\n')), tables: tablesOf(section) }));
}

function tableAt(sections: readonly Section[], index: number, what: string): Table {
  const table = sections
    .slice(0, 1)
    .flatMap(({ tables }) => tables.slice(0, 2))
    .at(index);
  if (table === undefined) {
    throw new Error(`The terminology page has no table of ${what}`);
  }
  return table;
}

function plain(text: string): string {
  return text
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replaceAll(/\*\*|`/gu, '')
    .trim();
}

function asSentence(text: string): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function lineOf(term: string, meaning: string): string {
  return `- ${plain(term)}: ${plain(meaning)}`;
}

function isGiven(text: string | undefined): text is string {
  return text !== undefined;
}

function capabilityLinesOf(sections: readonly Section[], served: readonly string[]): readonly string[] {
  const capabilities = tableAt(sections, 0, 'capabilities');
  const describing = new Map(tableAt(sections, 1, 'categories').map(({ term, meaning }) => [term, meaning]));
  return capabilities
    .filter(({ meaning }) => served.includes(meaning.toLowerCase()))
    .map(({ term, meaning }) =>
      lineOf(
        term,
        [meaning, describing.get(term)]
          .filter((part) => isGiven(part))
          .map((part) => asSentence(part))
          .join(' '),
      ),
    );
}

function termLinesOf(sections: readonly Section[], served: readonly string[]): readonly string[] {
  const capabilities = tableAt(sections, 0, 'capabilities');
  const unservedTypes = capabilities
    .map(({ meaning }) => meaning.toLowerCase())
    .filter((resource) => resource.endsWith(' function') && !served.includes(resource));
  const unservedCapabilities = new Set(
    capabilities.filter(({ meaning }) => unservedTypes.includes(meaning.toLowerCase())).map(({ term }) => term),
  );
  const namesNoneUnserved = ({ meaning }: Row) => !unservedTypes.some((type) => meaning.toLowerCase().includes(type));
  return sections
    .slice(1)
    .filter(({ heading, tables }) => tables.length > 0 && !unservedCapabilities.has(heading))
    .flatMap(({ heading, tables }) =>
      ['', `${heading}:`, ''].concat(
        tables.flatMap((rows) =>
          rows.filter((row) => namesNoneUnserved(row)).map(({ term, meaning }) => lineOf(term, asSentence(meaning))),
        ),
      ),
    );
}

const goalTerm = {
  told: "- Goal: What a playbook is for, in the person's own words, with how they will know it worked and what they want to be told about, and where. A playbook owns its goals, and the first one leads.",
  untold:
    "- Goal: What a playbook is for, in the person's own words, with how they will know it worked. A playbook owns its goals, and the first one leads.",
};

const goalsTerms: readonly string[] = [
  "- Milestone: One of the three to seven points of a goal that matter, where the person acts or where Auto collects something. Each is one segment of the goal's ring, and a workflow marks one through its contribution.",
  '- Measure: The one number a goal is judged by, with its label and its target.',
  "- Contribution: What a workflow does for a goal, written under contributes in its document: its purpose in the person's words, the milestone it marks and the measure it reports.",
  '- Verdict: Where one judging of a goal stands: open, passed or failed. The goal gives its own words for passed and failed.',
];

const messageTerms: readonly string[] = [
  '- Message: What Auto sends the person when a judging of a goal passes, fails or becomes overdue, through the notification function the goal names. The runtime calls it a notice, as in the gap kinds that begin notice_.',
  "- Summary: What Auto sends the person on the goal's own schedule, summing up its judgings.",
];

function goalsTermsOf(goals: boolean, messages: boolean): readonly string[] {
  if (!goals) {
    return [];
  }
  return [
    '',
    'Goals:',
    '',
    messages ? goalTerm.told : goalTerm.untold,
    ...goalsTerms,
    ...(messages ? messageTerms : []),
  ];
}

export function terminologyGuideOf(
  page: string,
  served: readonly string[],
  { goals = false, messages = false }: { readonly goals?: boolean; readonly messages?: boolean } = {},
): Guide {
  const sections = sectionsOf(page);
  return {
    name: 'terminology',
    title: 'Terminology',
    description: 'What the words of a playbook mean: its capabilities, function types, definitions, runs and assets.',
    text: [
      '# Terminology',
      '',
      'The words of a playbook, as its terminology gives them, to use with the person.',
      '',
      'The capabilities, the resource each one defines and what it does:',
      '',
      ...capabilityLinesOf(sections, served),
      ...termLinesOf(sections, served),
      ...goalsTermsOf(goals, messages),
      '',
    ].join('\n'),
  };
}
