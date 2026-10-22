import { executedOn } from '../recorded/sqlite-checks.ts';
import { layoutWritten } from './layout-kept.ts';

export function aSQLiteFileInLayout(fileName: string, layout: number): Promise<void> {
  return executedOn(fileName, (execute) => layoutWritten(execute, layout));
}
