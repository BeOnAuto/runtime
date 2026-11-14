import {
  portableDefinitionOf,
  portablePackageOf,
  type PortableDefinition,
  type PortablePackage,
} from './portable-package.ts';

export type PortablePart = 'goals' | 'page' | 'definition' | 'entry';

export type DefinitionField = 'source' | 'overview' | 'diagram';

export interface TextPlace {
  readonly part: PortablePart;
  readonly name?: string;
  readonly field?: DefinitionField;
}

export interface PortableText extends TextPlace {
  readonly text: string;
}

export function subjectOf({ type, name }: Pick<PortableDefinition, 'type' | 'name'>): string {
  return `${type}/${name}`;
}

function keyOf({ part, name, field }: TextPlace): string {
  return JSON.stringify([part, name ?? '', field ?? '']);
}

function textOf(place: TextPlace, text: string | undefined): PortableText[] {
  return text === undefined ? [] : [{ ...place, text }];
}

function definitionTexts(definition: PortableDefinition): PortableText[] {
  const name = subjectOf(definition);
  return [
    ...textOf({ part: 'definition', name, field: 'source' }, definition.source),
    ...textOf({ part: 'definition', name, field: 'overview' }, definition.overview),
    ...textOf({ part: 'definition', name, field: 'diagram' }, definition.diagram),
  ];
}

export function textsOfPackage(written: PortablePackage): PortableText[] {
  return [
    ...textOf({ part: 'goals' }, written.goals),
    ...textOf({ part: 'page' }, written.page),
    ...written.definitions.flatMap(definitionTexts),
  ];
}

export function packageWithTexts(written: PortablePackage, texts: readonly PortableText[]): PortablePackage {
  const byPlace = new Map(texts.map((text) => [keyOf(text), text.text]));
  const textAt = (place: TextPlace, before: string | undefined): string | undefined =>
    before === undefined ? undefined : (byPlace.get(keyOf(place)) ?? before);
  const goals = textAt({ part: 'goals' }, written.goals);
  const page = textAt({ part: 'page' }, written.page);
  return portablePackageOf({
    format: written.format,
    ...(goals === undefined ? {} : { goals }),
    ...(page === undefined ? {} : { page }),
    definitions: written.definitions.map((definition) => {
      const name = subjectOf(definition);
      const overview = textAt({ part: 'definition', name, field: 'overview' }, definition.overview);
      const diagram = textAt({ part: 'definition', name, field: 'diagram' }, definition.diagram);
      return portableDefinitionOf({
        type: definition.type,
        name: definition.name,
        source: byPlace.get(keyOf({ part: 'definition', name, field: 'source' })) ?? definition.source,
        ...(overview === undefined ? {} : { overview }),
        ...(diagram === undefined ? {} : { diagram }),
        paused: definition.paused,
      });
    }),
  });
}
