import { NotFound } from '@on.auto/operations';

export function playbookNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no playbook ${id} in this org` });
}
