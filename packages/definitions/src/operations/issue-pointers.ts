import { InvalidInput, type Issue, type Options } from '@on.auto/operations';

export interface Rejection {
  readonly detail: string;
  readonly issues: readonly Issue[];
  readonly options?: Options | undefined;
}

export function issuesUnder(field: string, issues: readonly Issue[]): readonly Issue[] {
  return issues.map(({ detail, pointer }) => ({ detail, pointer: `/${field}${pointer}` }));
}

function optionsUnder(field: string, { question, choices }: Options): Options {
  return {
    question,
    choices: choices.map((choice) => ({ ...choice, issues: issuesUnder(field, choice.issues) })),
  };
}

export function rejectionOfSource({ detail, issues, options }: Rejection): InvalidInput {
  return new InvalidInput({
    detail,
    issues: issuesUnder('source', issues),
    ...(options === undefined ? {} : { options: optionsUnder('source', options) }),
  });
}
