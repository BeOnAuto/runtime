import { ActivitySeenSchema, CommentEventSchema } from '@on.auto/activity';
import { PlaybookEventSchema } from '@on.auto/playbooks';
import { VoiceEventSchema } from '@on.auto/reasoning';

export const orgFactSchemas = [PlaybookEventSchema, ActivitySeenSchema, CommentEventSchema, VoiceEventSchema];
