import { catalogPathOf, type Catalog, type RouteRegistration } from '@on.auto/operations';

export interface RouteEntry {
  readonly registration: RouteRegistration;
  readonly path: string;
}

interface Templated {
  readonly registration: RouteRegistration;
  readonly template: string;
}

export const versionPrefix = '/v1';

const parameter = /\{(\w+)\}/gu;

function templateOf(registration: RouteRegistration): Templated {
  return { registration, template: `${versionPrefix}${catalogPathOf(registration)}` };
}

function orderOf({ template }: Templated): string {
  return template
    .split('/')
    .map((segment) => (segment.startsWith('{') ? '1' : `0${segment}`))
    .join('/');
}

function literalsFirst(left: Templated, right: Templated): number {
  const [first, second] = [orderOf(left), orderOf(right)];
  return Number(first > second) - Number(first < second);
}

export function routeTableOf(catalog: Catalog): readonly RouteEntry[] {
  return catalog.operations
    .map(templateOf)
    .toSorted(literalsFirst)
    .map(({ registration, template }) => ({ registration, path: template.replaceAll(parameter, ':$1') }));
}
