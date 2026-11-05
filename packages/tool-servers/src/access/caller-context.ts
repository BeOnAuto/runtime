import type { CallJournal } from '../calls/recorded-calls.ts';
import type { KeepImage } from '../images/answered-images.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';
import type { ToolServerFailed } from './tool-server-failed.ts';

export interface CallerContext {
  readonly id: string;
  readonly org: string;
  readonly playbook: string;
  readonly journal: CallJournal;
  readonly meta: Readonly<Record<string, string>>;
  readonly keepImage?: KeepImage;
}

export interface ServerMessage {
  readonly server: string;
  readonly message: string;
  readonly run_id: string | null;
  readonly call_id: string | null;
}

export type ToolsNotOpened = ToolNotOffered | ToolServerFailed;
