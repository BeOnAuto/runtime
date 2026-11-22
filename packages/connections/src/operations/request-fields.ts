import { Schema } from 'effect';

export const mostMessageCharacters = 500;

export function messageFieldOf(most: number) {
  return Schema.String.check(Schema.isMaxLength(most)).annotate({
    description:
      'Give what the person said they need the app for, in their own words, and leave it out when they gave no reason. It is used only when the person may not approve the connection: the admins read it beside the request. Otherwise it is ignored.',
  });
}

export const MessageField = messageFieldOf(mostMessageCharacters);
