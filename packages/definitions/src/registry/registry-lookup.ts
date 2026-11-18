import { NotFound } from '@on.auto/operations';

import { definitionResourceLabel } from '../capability/function-terminology.ts';

export function definitionNotFound(type: string, name: string): NotFound {
  return new NotFound({ detail: `There is no ${definitionResourceLabel(type)} ${name} in this playbook` });
}

export function versionNotFound(type: string, name: string, version: number): NotFound {
  return new NotFound({
    detail: `There is no version ${version} of the ${definitionResourceLabel(type)} ${name} in this playbook`,
  });
}
