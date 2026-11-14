import { contributesIn } from '../contributions/contributes-details.ts';
import type { Definition, StoredDefinition } from '../registry/definition.ts';
import { shapeNameIn } from '../shapes/published-output.ts';

export function publishedDetails({ details }: StoredDefinition, goals: boolean): Pick<Definition, 'details'> {
  const shape = shapeNameIn(details);
  const contributes = goals ? contributesIn(details) : undefined;
  const published = {
    ...(shape === undefined ? {} : { shape }),
    ...(contributes === undefined ? {} : { contributes }),
  };
  return Object.keys(published).length === 0 ? {} : { details: published };
}
