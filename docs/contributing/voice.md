# Auto voice

Auto sounds like a knowledgeable colleague explaining what is happening and what to do next. Use familiar words, specific product terms and natural sentences. Be calm when something goes wrong, and explicit when a decision has consequences.

This guide applies to interface text, accessibility labels, emails, errors and playbook overviews. Use it with [Playbook terminology](../concepts/terminology.md). For documentation structure, follow the [documentation contribution guide](documentation.md).

## Write for the task

Lead with the state, action or result. Name the connection, invitation or run involved when a pronoun would be unclear. Use ordinary verbs such as save, load, connect, invite, delete and expire.

Supporting text should explain a consequence or a next step. Keep a clear heading such as "No playbooks yet"; use the description to help someone create one. Omit descriptions that only repeat their headings.

Natural contractions are welcome. Keep useful warmth, but leave jokes, staged reassurance and sales claims out of errors, billing, permissions and deletion flows. Do not rewrite a natural phrase just to make it shorter.

Keep technical detail when it helps someone configure or troubleshoot something. MCP belongs in agent setup. JSON belongs in an input editor. A general settings message usually needs the name of the task, rather than an internal service or protocol.

## Keep the meaning accurate

Read the code path before changing a claim. Preserve permissions, scope, timing, recovery windows and uncertainty.

- A failed request does not prove that an item is missing.
- An unconfirmed response does not prove that a change failed or succeeded.
- A request to cancel is different from confirmed cancellation.
- A retry can have consequences. Offer it only when the action is safe to repeat.
- A deletion message must retain any restoration window and explain what happens to access, subscriptions and data.

Keep relevant conditions with the claim they qualify. For example, a limit on monthly Free credits must not imply that purchased credits have the same limit. Never invent a refund, recovery option or guarantee.

## Terms and conventions

| Use                               | Meaning or convention                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Auto                              | The product and service.                                                                                                |
| Studio                            | The interface used to manage and inspect playbooks.                                                                     |
| Auto Runtime                      | The installed software that executes playbooks.                                                                         |
| Organization                      | Use the full word in product text. Keep `org` in exact API names and identifiers.                                       |
| Admin, Member                     | Use the actual shared-organization role names. Personal accounts have their own permissions.                            |
| Playbook, function, workflow, run | Keep the meanings in [Playbook terminology](../concepts/terminology.md). A copy edit must not rename the product model. |
| Sign in, sign out                 | Use these verbs consistently. Use "sign-in" as an adjective.                                                            |
| Delete, remove, revoke, retire    | Preserve their distinct effects. Name the object and explain the consequences that matter.                              |

Use US English and sentence-case headings. Use an ellipsis for an action in progress, such as "Loading connections…". Full sentences take a period; short labels do not need one. Avoid em dashes and decorative emphasis. Preserve exact code identifiers and third-party product labels.

## Common states

| State              | Example                                                                      | Check                                                              |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Empty list         | "No playbooks yet" / "Ask your agent to create your first playbook."         | Does the next step work from this screen?                          |
| Loading            | "Loading connections…"                                                       | Name the thing being loaded when the context needs it.             |
| Success            | "Message sent. We’ll reply by email."                                        | State only a confirmed result.                                     |
| Permission         | "Only admins can change billing settings."                                   | Verify the permission, including personal-account behavior.        |
| Failed read        | "Couldn’t load connections. Try again."                                      | Use this for a failed read, not a change whose outcome is unknown. |
| Unconfirmed change | "Auto returned an unexpected response. Refresh to check the current status." | Do not claim that the change failed.                               |
| Destructive action | "Delete {name}?"                                                             | Explain the scope, consequences and any recovery window nearby.    |

Keep good short copy such as "Save", "Cancel", "Connected", "Needs attention", "Copied" and "Keep editing". Consistency does not require making every message sound alike.

## Playbook overviews

Write for the person using the playbook. Explain what the definition does, why it is needed and how it fits the playbook, using only the definition and context the user supplied. Use one to three short paragraphs. Include a fenced Mermaid diagram when it helps explain the process.

Describe concrete work and results. Avoid invented benefits, sales language and unsupported claims about accuracy, speed or reliability. Keep user-authored descriptions and historic run output unchanged unless the user asks to edit them.

Agents connected to Auto can read this guide with `get_guide` using `{"guide":"voice"}`. The guide is also available at `/v1/guides/voice` on the runtime serving that connection.

## Review a copy change

Read the whole screen or message with realistic names, counts and dates. Check the affected empty, loading, error, permission and destructive states, including accessibility text.

Reuse shared messages when the meaning matches. Keep message IDs, placeholders, plurals and external labels correct. Give different meanings different IDs, and add a description when a translator would need context.

Run a humanizer pass: remove staged openers, forced contrasts, filler, repeated conclusions and inflated claims. Then check that the edit kept every supported fact. Mechanical checks can catch duplicate IDs and malformed placeholders; editorial review decides whether the writing is useful and natural.

Show substantive before-and-after wording in the pull request. Flag behavior or terminology decisions separately from copy edits.
