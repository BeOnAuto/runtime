import type { Issue } from '@on.auto/operations';

import { BLANK_NAME, blankFor, blankSpansIn, lineAt } from './blanks.ts';
import { packageWithTexts, textsOfPackage, type PortableText, type TextPlace } from './package-texts.ts';
import type { PortablePackage } from './portable-package.ts';
import { matchedIn, valueMatchesIn, type Matched, type ValueClass } from './value-classes.ts';
import {
  findingId,
  findingsIn,
  scanFormOf,
  standingMatchesIn,
  writtenSpanOf,
  type Finding,
  type Occurrence,
  type Span,
} from './value-scan.ts';

export interface LeaveOut {
  readonly finding: string;
  readonly name: string;
}

export interface Decisions {
  readonly leave_out: readonly LeaveOut[];
  readonly cleared: readonly string[];
}

export interface Resolution {
  readonly fit: boolean;
  readonly issues: readonly Issue[];
  readonly texts: readonly PortableText[];
  readonly secrets: readonly Finding[];
  readonly unresolved: readonly Finding[];
  readonly standing: readonly LeftStanding[];
}

export interface LeftStanding {
  readonly finding: string;
  readonly name: string;
  readonly class: ValueClass;
  readonly value: string;
  readonly joined: boolean;
  readonly occurrences: readonly Occurrence[];
}

interface Blanked {
  readonly finding: Finding;
  readonly name: string;
  readonly blank: string;
}

interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly blanked: Blanked;
}

interface Unseen {
  readonly blanked: Blanked;
  readonly line: number;
}

interface Written {
  readonly text: string;
  readonly unseen: readonly Unseen[];
}

function occurrencesIn(text: string, value: string): Span[] {
  const places: Span[] = [];
  for (let from = text.indexOf(value); from !== -1; from = text.indexOf(value, from + 1)) {
    places.push({ from, to: from + value.length });
  }
  return places;
}

function replacementsIn(text: string, values: readonly Blanked[]): Replacement[] {
  const form = scanFormOf(text);
  const claimed: Replacement[] = [];
  const secrets = valueMatchesIn(form.text)
    .filter((match) => match.class === 'secret')
    .map((match) => writtenSpanOf(form, match));
  for (const blanked of values) {
    for (const place of occurrencesIn(form.text, blanked.finding.value).map((found) => writtenSpanOf(form, found))) {
      const taken = [...secrets, ...claimed];
      if (taken.some(({ from, to }) => place.from < to && from < place.to)) continue;
      claimed.push({ ...place, blanked });
    }
  }
  return claimed.toSorted((left: Replacement, right: Replacement) => left.from - right.from);
}

function leftOutOf(text: string, values: readonly Blanked[]): Written {
  let written = '';
  let kept = 0;
  const placed: { readonly blanked: Blanked; readonly from: number; readonly to: number }[] = [];
  for (const { from, to, blanked } of replacementsIn(text, values)) {
    written += text.slice(kept, from);
    placed.push({ blanked, from: written.length, to: written.length + blanked.blank.length });
    written += blanked.blank;
    kept = to;
  }
  written += text.slice(kept);
  const spans = blankSpansIn(written);
  const seen = (place: (typeof placed)[number]): boolean =>
    spans.some(({ name, from, to }) => name === place.blanked.name && from < place.to && place.from < to);
  return {
    text: written,
    unseen: placed
      .filter((place) => !seen(place))
      .map(({ blanked, from }) => ({ blanked, line: lineAt(written, from) })),
  };
}

function longestFirst(left: Blanked, right: Blanked): number {
  const [one, other] = [left.finding.value, right.finding.value];
  if (one.length !== other.length) return other.length - one.length;
  return one < other ? -1 : 1;
}

function blanksOf(findings: readonly Finding[], leaveOuts: readonly LeaveOut[]): Blanked[] {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return leaveOuts
    .flatMap(({ finding, name }) => {
      const found = byId.get(finding);
      return found === undefined || found.class === 'secret'
        ? []
        : [{ finding: found, name, blank: blankFor(found, name) }];
    })
    .toSorted((left: Blanked, right: Blanked) => longestFirst(left, right));
}

interface LeftOutTexts {
  readonly texts: readonly PortableText[];
  readonly unseen: readonly (Unseen & { readonly place: TextPlace })[];
}

interface PlacedWritten {
  readonly place: TextPlace;
  readonly left: Written;
}

function textsLeftOut(texts: readonly PortableText[], values: readonly Blanked[]): LeftOutTexts {
  const written = texts.map(({ text, ...place }): PlacedWritten => ({
    place,
    left: place.part === 'goals' ? { text, unseen: [] } : leftOutOf(text, values),
  }));
  return {
    texts: written.map(({ place, left }: PlacedWritten) => ({ ...place, text: left.text })),
    unseen: written.flatMap(({ place, left }: PlacedWritten) =>
      left.unseen.map((unseen: Unseen) => ({ ...unseen, place })),
    ),
  };
}

export function leftOutTexts(texts: readonly PortableText[], leaveOuts: readonly LeaveOut[]): PortableText[] {
  return [...textsLeftOut(texts, blanksOf(findingsIn(texts), leaveOuts)).texts];
}

const syntaxCharacter = /[\\^$.*+?()[\]{}|/]/gu;

function literally(value: string): string {
  return value.replaceAll(syntaxCharacter, String.raw`\$&`);
}

function stillStanding(
  texts: readonly PortableText[],
  values: readonly Blanked[],
  decided: ReadonlySet<string>,
): (Unseen & { readonly place: TextPlace })[] {
  return texts.flatMap(({ text: written, ...place }) => {
    const { text } = scanFormOf(written);
    const reported = standingMatchesIn(text).filter((match) => decided.has(findingId(match.class, match.value)));
    return values.flatMap((blanked) =>
      matchedIn(text, new RegExp(literally(blanked.finding.value), 'giu'))
        .filter(
          ({ text: found, at }: Matched) => !reported.some(({ from, to }) => from <= at && at + found.length <= to),
        )
        .map(({ at }: Matched) => ({ blanked, line: lineAt(text, at), place })),
    );
  });
}

function standingOf(unseen: readonly (Unseen & { readonly place: TextPlace })[], joined: boolean): LeftStanding[] {
  const byFinding = new Map<string, LeftStanding>();
  for (const { blanked, line, place } of unseen) {
    const key = `${blanked.finding.id} ${blanked.name}`;
    const known = byFinding.get(key) ?? {
      finding: blanked.finding.id,
      name: blanked.name,
      class: blanked.finding.class,
      value: blanked.finding.value,
      joined,
      occurrences: [],
    };
    const occurrence = { ...place, line };
    const twice = known.occurrences.some((seen) => JSON.stringify(seen) === JSON.stringify(occurrence));
    byFinding.set(key, twice ? known : { ...known, occurrences: [...known.occurrences, occurrence] });
  }
  return [...byFinding.values()];
}

function decisionIssues(findings: readonly Finding[], { leave_out, cleared }: Decisions): Issue[] {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const secretWords = 'is a value of a known secret shape, which can only be removed from the definition';
  const decided = (id: string, pointer: string): Issue[] => {
    const found = byId.get(id);
    if (found === undefined) return [{ pointer, detail: `${id} is not a finding of this package` }];
    return found.class === 'secret' ? [{ pointer, detail: `${id} ${secretWords}` }] : [];
  };
  return [
    ...leave_out.flatMap(({ finding, name }, index) => [
      ...decided(finding, `/leave_out/${index}/finding`),
      ...(BLANK_NAME.test(name)
        ? []
        : [
            {
              pointer: `/leave_out/${index}/name`,
              detail: `${name} is not a blank's name: capital letters, digits and underscores, 2 to 40, starting with a letter`,
            },
          ]),
      ...(leave_out.findIndex((other) => other.finding === finding) === index
        ? []
        : [{ pointer: `/leave_out/${index}/finding`, detail: `${finding} is left out twice` }]),
    ]),
    ...cleared.flatMap((id, index) => decided(id, `/cleared/${index}`)),
  ];
}

export function resolutionOf(texts: readonly PortableText[], decisions: Decisions): Resolution {
  const findings = findingsIn(texts);
  const issues = decisionIssues(findings, decisions);
  const named = decisions.leave_out.filter(({ name }) => BLANK_NAME.test(name));
  const values = blanksOf(findings, named);
  const left = textsLeftOut(texts, values);
  const remaining = findingsIn(left.texts);
  const cleared = new Set(decisions.cleared);
  const secrets = remaining.filter((finding) => finding.class === 'secret');
  const unseen = left.unseen.map(({ blanked }) => blanked.blank);
  const unresolved = remaining.filter(
    (finding) =>
      finding.class !== 'secret' && !cleared.has(finding.id) && !unseen.some((blank) => finding.value.includes(blank)),
  );
  const reported = new Set([...secrets, ...unresolved].map(({ id }) => id));
  const still = stillStanding(left.texts, values, reported);
  const inGoals = ({ blanked, place }: (typeof still)[number]): boolean =>
    place.part === 'goals' && !cleared.has(blanked.finding.id);
  const standing = [
    ...standingOf(left.unseen, true),
    ...standingOf(
      still.filter(({ place }) => place.part !== 'goals'),
      false,
    ),
    ...standingOf(
      still.filter((found) => inGoals(found)),
      false,
    ),
  ];
  return {
    fit: issues.length === 0 && secrets.length === 0 && unresolved.length === 0 && standing.length === 0,
    issues,
    texts: left.texts,
    secrets,
    unresolved,
    standing,
  };
}

export function packageLeftOut(written: PortablePackage, leaveOuts: readonly LeaveOut[]): PortablePackage {
  return packageWithTexts(written, leftOutTexts(textsOfPackage(written), leaveOuts));
}

export function packageResolution(
  written: PortablePackage,
  decisions: Decisions,
  entry: readonly PortableText[] = [],
): Resolution & { readonly package: PortablePackage } {
  const resolution = resolutionOf([...textsOfPackage(written), ...entry], decisions);
  return { ...resolution, package: packageWithTexts(written, resolution.texts) };
}
