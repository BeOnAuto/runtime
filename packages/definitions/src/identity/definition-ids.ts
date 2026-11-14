import { uuidV5, type PlaybookAddress } from '@on.auto/operations';

const earlierDefinitions = 'e7d1798d-f495-4b6b-a67d-5573aac17543';

export interface DefinitionAddress extends PlaybookAddress {
  readonly type: string;
  readonly name: string;
}

export function earlierDefinitionIdOf({ org, playbook, type, name }: DefinitionAddress): string {
  return uuidV5(earlierDefinitions, JSON.stringify([org, playbook, type, name]));
}

export function definitionKeyOfId(org: string, id: string): string {
  return `definition/${org}/${id}/`;
}
