import { fileSettings } from '../../config-file/file-settings.ts';
import { variablesTheRuntimeReads } from '../../connections/variables-the-runtime-reads.ts';

export const settingNames: readonly string[] = [
  ...new Set([...variablesTheRuntimeReads, ...fileSettings.map(({ key }) => key)]),
];
