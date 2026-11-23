import { chatRenderingOf, type ChatRendering } from '@on.auto/interaction';
import { Option } from 'effect';

export const slackChatRenderingForTests: ChatRendering = Option.getOrThrow(
  Option.fromNullishOr(chatRenderingOf('slack')),
);
