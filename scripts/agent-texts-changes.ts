import { cellsOf, sentencesOfText, type Sentence } from './agent-text-sentences.ts';
import {
  bytesOf,
  bytesOfEveryText,
  placesIn,
  type AgentTextsRecord,
  type Place,
  type Tier,
} from './agent-texts-record.ts';
import { sentenceChangesBetween, type SentenceChange } from './sentence-changes.ts';

interface Records {
  readonly before: AgentTextsRecord;
  readonly after: AgentTextsRecord;
}

interface TextChange {
  readonly before: string | undefined;
  readonly after: string | undefined;
  readonly tier: Tier;
  readonly places: readonly Place[];
}

type Connections = ReadonlyMap<string, ReadonlySet<string>>;

const codeSpan = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/gu;

const link = /!?\[([^\]]*)\]\([^)]*\)/gu;

const escapedCharacter = /\\([!-/:-@[-`{-~])/gu;

const shownLiterally = /[\\`*[\]<~$@]|&(?=#?\w+;)|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;

const numbers = new Intl.NumberFormat('en-US');

export function inTurn(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
}

function proseShown(prose: string): string {
  return prose
    .replaceAll(link, '$1')
    .replaceAll('**', '')
    .replaceAll(escapedCharacter, '$1')
    .replaceAll(shownLiterally, String.raw`\$&`);
}

function codeShown(code: string): string {
  const runs = (code.match(/`+/gu) ?? []).map((run) => run.length);
  const fence = '`'.repeat(Math.max(0, ...runs) + 1);
  const padding = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${code}${padding}${fence}`;
}

function codeIn(content: string): string {
  return content.trim() !== '' && content.startsWith(' ') && content.endsWith(' ') ? content.slice(1, -1) : content;
}

export function wordsShown(markdown: string): string {
  let shown = '';
  let from = 0;
  for (const { index, 0: span, 2: content = '' } of markdown.matchAll(codeSpan)) {
    shown += `${proseShown(markdown.slice(from, index))}${codeShown(codeIn(content))}`;
    from = index + span.length;
  }
  return `${shown}${proseShown(markdown.slice(from))}`;
}

function rowShown(row: string): string {
  return cellsOf(row)
    .map((cell) => wordsShown(cell))
    .join(' · ');
}

function sentenceShown({ kind, source }: Sentence): string {
  if (kind === 'example') {
    return codeShown(source.trim());
  }
  return kind === 'row' ? rowShown(source) : wordsShown(source);
}

function higherOf(one: Tier, other: Tier): Tier {
  return one <= other ? one : other;
}

function placeKeyOf({ as, on }: Place): string {
  return `${as}\n${on}`;
}

function changeKeyOf(before: Place | undefined, after: Place | undefined): string {
  return JSON.stringify([before?.text ?? null, after?.text ?? null]);
}

function withPlace(
  known: TextChange | undefined,
  place: Place,
  texts: readonly [string | undefined, string | undefined],
): TextChange {
  const [before, after] = texts;
  return {
    before,
    after,
    tier: higherOf(known?.tier ?? place.tier, place.tier),
    places: [...(known?.places ?? []), place],
  };
}

function changedTexts({ before, after }: Records): readonly TextChange[] {
  const placesBefore = new Map(placesIn(before).map((place) => [placeKeyOf(place), place]));
  const placesAfter = new Map(placesIn(after).map((place) => [placeKeyOf(place), place]));
  const changes = new Map<string, TextChange>();
  for (const key of new Set([...placesAfter.keys(), ...placesBefore.keys()])) {
    const was = placesBefore.get(key);
    const is = placesAfter.get(key);
    const place = is ?? was;
    if (place !== undefined && was?.text !== is?.text) {
      const changeKey = changeKeyOf(was, is);
      changes.set(changeKey, withPlace(changes.get(changeKey), place, [was?.text, is?.text]));
    }
  }
  return [...changes.values()].toSorted((one, other) => one.tier - other.tier);
}

function connectionsOf({ before, after }: Records): Connections {
  const connections = new Map<string, ReadonlySet<string>>();
  for (const { as, on } of [...placesIn(before), ...placesIn(after)]) {
    connections.set(as, new Set([...(connections.get(as) ?? []), on]));
  }
  return connections;
}

function placesShown(places: readonly Place[], connections: Connections): readonly string[] {
  return [...new Set(places.map(({ as }) => as))].toSorted().map((as) => {
    const on = places.filter((place) => place.as === as).map((place) => wordsShown(place.on));
    return on.length === connections.get(as)?.size ? wordsShown(as) : `${wordsShown(as)}, on ${inTurn(on)}`;
  });
}

function bytesBeforeAndAfter(before: number, after: number): string {
  const difference =
    after === before ? 'the same' : `${numbers.format(Math.abs(after - before))} ${after > before ? 'more' : 'fewer'}`;
  return `${numbers.format(before)} bytes before, ${numbers.format(after)} after, ${difference}`;
}

function contextOf({ before, after }: SentenceChange): string {
  const sentence = after ?? before;
  const heading = sentence === undefined || sentence.heading === '' ? '' : `**${wordsShown(sentence.heading)}**`;
  if (sentence?.kind === 'example') {
    return heading === '' ? 'In an example:' : `Under ${heading}, in an example:`;
  }
  return heading === '' ? '' : `Under ${heading}:`;
}

function pairShown({ before, after }: SentenceChange): readonly string[] {
  const was = before === undefined ? 'not there' : sentenceShown(before);
  const is = after === undefined ? 'removed' : sentenceShown(after);
  const formattedOnly = before !== undefined && after !== undefined && was === is;
  return [`- Before: ${was}`, '', `  After: ${formattedOnly ? 'the same words, formatted differently' : is}`, ''];
}

function sentencesShown({ before, after }: TextChange): readonly string[] {
  const changes = sentenceChangesBetween(sentencesOfText(before ?? ''), sentencesOfText(after ?? ''));
  if (changes.length === 0) {
    return ['The words are the same; only spaces or line breaks changed.', ''];
  }
  const shown: string[] = [];
  let context = '';
  for (const change of changes) {
    const next = contextOf(change);
    shown.push(...(next === context || next === '' ? [] : [next, '']), ...pairShown(change));
    context = next;
  }
  return shown;
}

function wordsElsewhere(text: string | undefined, record: AgentTextsRecord): readonly Place[] {
  return placesIn(record).filter((place) => place.text === text);
}

function statusShown(change: TextChange, records: Records, connections: Connections): readonly string[] {
  const { before, after } = change;
  if (before === undefined) {
    const known = wordsElsewhere(after, records.before);
    return known.length === 0
      ? ['New: an agent did not receive this text before.', '', ...sentencesShown(change)]
      : [`Its words are not new: an agent read them before as ${inTurn(placesShown(known, connections))}.`, ''];
  }
  if (after === undefined) {
    const kept = wordsElsewhere(before, records.after);
    return kept.length === 0
      ? ['Removed: an agent no longer receives this text.', '', ...sentencesShown(change)]
      : [`An agent still reads the same words as ${inTurn(placesShown(kept, connections))}.`, ''];
  }
  return sentencesShown(change);
}

function changeShown(change: TextChange, records: Records, connections: Connections): readonly string[] {
  const [first = '', ...others] = placesShown(change.places, connections);
  const also = others.length === 0 ? '' : ` Also received as ${inTurn(others)}.`;
  return [
    `### ${first}`,
    '',
    `Tier ${change.tier}.${also}`,
    '',
    ...statusShown(change, records, connections),
    `Size: ${bytesBeforeAndAfter(bytesOf(change.before ?? ''), bytesOf(change.after ?? ''))}.`,
    '',
  ];
}

function tiersShown({ tiers }: AgentTextsRecord, changes: readonly TextChange[]): readonly string[] {
  return [...new Set(changes.map(({ tier }) => tier))].map((tier) =>
    `- Tier ${tier}. ${tiers[String(tier)] ?? ''}`.trimEnd(),
  );
}

export function changesBetween(records: Records): string {
  const changes = changedTexts(records);
  if (changes.length === 0) {
    return 'Nothing an agent reads changed.\n';
  }
  const connections = connectionsOf(records);
  const counted =
    changes.length === 1 ? '1 text an agent reads changed' : `${changes.length} texts an agent reads changed`;
  const total = bytesBeforeAndAfter(bytesOfEveryText(records.before), bytesOfEveryText(records.after));
  return [
    '## What an agent reads: before and after',
    '',
    `${counted}. Each text below is named by where an agent receives it, then gives its tier, each sentence that changed, before and after, and its size.`,
    '',
    'The tiers:',
    '',
    ...tiersShown(records.after, changes),
    '',
    ...changes.flatMap((change) => changeShown(change, records, connections)),
    '### In total',
    '',
    `Every text an agent reads, each counted once: ${total}.`,
    '',
  ].join('\n');
}
