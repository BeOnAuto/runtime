import type { Runner } from './advance.ts';
import { cancelList, resumeList, startList, yieldList } from './list-runner.ts';
import { cancelTask, invocationAt, resumeTask, startTask } from './task-runner.ts';

export const runner: Runner = {
  startTask,
  resumeTask,
  cancelTask,
  invocationAt,
  startList,
  yieldList,
  resumeList,
  cancelList,
};
