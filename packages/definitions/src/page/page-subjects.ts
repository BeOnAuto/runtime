import { functionTypeOrder } from '../capability/function-terminology.ts';
import { definitionNamePattern } from '../operations/definition-fields.ts';

export const pageDefinitionType = 'page';

export const playbookSubject = 'playbook';

export interface DefinitionSubject {
  readonly type: string;
  readonly name: string;
}

type PageSubject = DefinitionSubject | typeof playbookSubject;

const presentedTypes: readonly string[] = ['workflow', ...functionTypeOrder];

const typesInWords = `${presentedTypes.slice(0, -1).join(', ')} or ${String(presentedTypes.at(-1))}`;

const subjectWords = `of names the subject whose results the page presents: <type>/<name>, where the type is ${typesInWords}, or ${playbookSubject}`;

const presentsNoPage =
  'A page presents no page, since a page has no results to present; of names a workflow, a function or playbook';

type SubjectReading = { readonly subject: PageSubject } | { readonly refused: string };

export function subjectIn(of: string): SubjectReading {
  if (of === playbookSubject) {
    return { subject: playbookSubject };
  }
  const slash = of.indexOf('/');
  const type = of.slice(0, Math.max(0, slash));
  const name = of.slice(slash + 1);
  if (type === pageDefinitionType) {
    return { refused: presentsNoPage };
  }
  return presentedTypes.includes(type) && definitionNamePattern.test(name)
    ? { subject: { type, name } }
    : { refused: subjectWords };
}

export function subjectNamed(type: string, name: string): string {
  return `${type}/${name}`;
}
