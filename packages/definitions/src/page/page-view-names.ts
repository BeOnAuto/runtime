import type { PlaybookAddress } from '@on.auto/operations';

export function pageViewNameOf(subject: { readonly type: string; readonly name: string }): string {
  return `${subject.type}/${subject.name}`;
}

export function playbookPageViewNameOf({ playbook }: Pick<PlaybookAddress, 'playbook'>): string {
  return `playbook/${playbook}`;
}
