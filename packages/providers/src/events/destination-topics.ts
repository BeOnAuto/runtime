import { subscribesForEachPlace, type Destination, type DestinationIssue } from './destination-fields.ts';

interface WrittenTopic {
  readonly path: readonly (string | number)[];
  readonly start: string;
}

interface Earlier {
  readonly index: number;
  readonly topics: readonly WrittenTopic[];
}

const firstTag = /\{[{%]/u;

function writtenStartOf(template: string): string {
  const at = template.search(firstTag);
  return (at === -1 ? template : template.slice(0, at)).trimEnd();
}

function topicsOf({ topic, events = [] }: Destination): readonly WrittenTopic[] {
  return [
    ...(topic === undefined ? [] : [{ path: ['topic'], start: writtenStartOf(topic) }]),
    ...events.flatMap(({ topic: written }, index) =>
      [written]
        .filter((each) => each !== undefined)
        .map((each) => ({ path: ['events', index, 'topic'], start: writtenStartOf(each) })),
    ),
  ];
}

function typesOf({ events = [] }: Destination): ReadonlySet<string> {
  return new Set(events.map(({ type }) => type));
}

function reportsMoreThan(later: Destination, earlier: Destination): boolean {
  const reported = typesOf(earlier);
  return [...typesOf(later)].some((type) => !reported.has(type));
}

function canWriteTheSame(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

const sharedTopic = (earlier: number) =>
  `Expected a topic that cannot be the same as a topic of destination ${earlier}, which reports different events. The text before the first {{ of one must not be the beginning of the text before the first {{ of the other`;

function earlierOf(destinations: readonly Destination[], later: Destination, at: number): readonly Earlier[] {
  return destinations
    .slice(0, at)
    .flatMap((earlier, index) =>
      subscribesForEachPlace(earlier) && reportsMoreThan(later, earlier) ? [{ index, topics: topicsOf(earlier) }] : [],
    );
}

export function sharedTopicIssuesOf(destinations: readonly Destination[]): readonly DestinationIssue[] {
  return destinations.flatMap((later, at) => {
    if (!subscribesForEachPlace(later)) {
      return [];
    }
    const earlier = earlierOf(destinations, later, at);
    return topicsOf(later).flatMap(({ path, start }): readonly DestinationIssue[] => {
      const clash = earlier.find(({ topics }) => topics.some((other) => canWriteTheSame(start, other.start)));
      return clash === undefined ? [] : [{ path: ['destinations', at, ...path], issue: sharedTopic(clash.index) }];
    });
  });
}
