import { settingProblemText, type FileUse, type SettingProblem } from '@on.auto/config';

export function problemsListed(problems: readonly SettingProblem[], file: FileUse | undefined): string {
  return problems
    .map((problem) =>
      file !== undefined && file.fromFile.includes(problem.setting)
        ? file.placed(problem)
        : settingProblemText(problem),
    )
    .join('; ');
}
