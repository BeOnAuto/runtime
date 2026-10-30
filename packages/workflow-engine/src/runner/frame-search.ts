import type { Branch, FrameBody, ListCursor, TaskFrame } from '../machine/run-state.ts';

function framesOfCursor(cursor: ListCursor): readonly TaskFrame[] {
  return cursor.current.kind === 'running' ? framesOf(cursor.current.task) : [];
}

function framesOfBranch(branch: Branch): readonly TaskFrame[] {
  return branch.state === 'running' ? framesOf(branch.task) : [];
}

function framesWithin(body: FrameBody): readonly TaskFrame[] {
  if (body.kind === 'list' || body.kind === 'for') {
    return framesOfCursor(body.list);
  }
  if (body.kind === 'fork') {
    return body.branches.flatMap((branch: Branch) => framesOfBranch(branch));
  }
  return body.kind === 'try' && body.phase.kind !== 'backing_off' ? framesOfCursor(body.phase.list) : [];
}

function framesOf(frame: TaskFrame): readonly TaskFrame[] {
  return [frame, ...framesWithin(frame.body)];
}

export interface ListenFrame extends Omit<TaskFrame, 'body'> {
  readonly body: Extract<FrameBody, { readonly kind: 'listen' }>;
}

function isListenFrame(frame: TaskFrame): frame is ListenFrame {
  return frame.body.kind === 'listen';
}

export function listenFrameAt(root: TaskFrame | null, reference: string, run: number): ListenFrame | undefined {
  return (root === null ? [] : framesOf(root))
    .filter((frame) => isListenFrame(frame))
    .find((frame) => frame.reference === reference && frame.run === run);
}
