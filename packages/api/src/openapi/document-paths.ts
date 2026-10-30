import type { Catalog, RouteRegistration } from '@on.auto/operations';

import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guidePath, guidePathItemOf } from './guide-path.ts';
import { describedOperationOf, type DescribedOperation } from './operation-object.ts';
import { guidesTag, tagsNamed, type Tag } from './operation-tags.ts';
import type { OpenApiObject, ProblemAnswer } from './problem-responses.ts';

export interface DocumentPaths {
  readonly paths: OpenApiObject;
  readonly tags: readonly Tag[];
  readonly problems: readonly ProblemAnswer[];
}

function operationIdsOf(catalog: Catalog): (registration: RouteRegistration) => string {
  const inPlaybooks = new Set(catalog.operationsIn('playbook').map(({ name }) => name));
  return ({ scope, name }) => (scope === 'org' && inPlaybooks.has(name) ? `${name}_in_org` : name);
}

function pathItemsOf(described: readonly DescribedOperation[]): OpenApiObject {
  const paths = [...new Set(described.map(({ path }) => path))];
  return Object.fromEntries(
    paths.map((path) => [
      path,
      Object.fromEntries(
        described.filter((each) => each.path === path).map(({ method, operation }) => [method, operation]),
      ),
    ]),
  );
}

export function documentPathsOf(catalog: Catalog, shelf: GuideShelf): DocumentPaths {
  const operationIdOf = operationIdsOf(catalog);
  const described = catalog.operations.map((registration) =>
    describedOperationOf(registration, operationIdOf(registration)),
  );
  return {
    paths: { ...pathItemsOf(described), [guidePath]: guidePathItemOf(shelf) },
    tags: tagsNamed([...described.map(({ tag }) => tag), guidesTag]),
    problems: described.flatMap(({ problems }) => problems),
  };
}
