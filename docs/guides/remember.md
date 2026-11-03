---
description: Keep what your playbook learns as memories, for the playbook or its whole organization, and recall them when later work needs them.
---

<div v-pre>

# Make a playbook remember

Give later work what your playbook already knows. A memory is one short text the playbook keeps, with a few tags: a fact, a decision or a preference. The playbook remembers it, not your agent: what you want kept goes into the playbook's memory rather than your agent's own notes, so you, anyone else and the playbook's workflows can recall it later.

## Before you start

- You have a playbook. Its memories begin empty.
- Your agent is connected to Auto. The [quick start](../get-started/cloud.md) sets this up.

## Decide who keeps it

A memory is kept by the playbook or by its organization:

| Kept by          | Recalled by                        | For example                                              |
| ---------------- | ---------------------------------- | -------------------------------------------------------- |
| The playbook     | This playbook alone                | How this playbook's weekly report should open            |
| The organization | Every playbook of the organization | Who approves a budget, or the currency the team bills in |

Keep a memory for the playbook unless it is about the team or the business rather than this playbook's work.

## 1. Remember something

Ask your agent:

```text
In my "<playbook name>" playbook, remember that <the fact, in your words>.
It is about <this playbook's work, or the team>. Tag it <a word or two>.
```

Your agent calls `remember` once a fact, with a short plain text, its tags and its scope. A fact that holds for some days alone can name them, and one that stops mattering can expire, such as after `P90D`.

## 2. Recall it

Ask your agent, at any later time:

```text
What does my "<playbook name>" playbook remember about <words or a tag>?
```

Your agent calls `recall`. It answers the memories that hold every word and have every tag asked, newest first, from the playbook and its organization. Words are compared without regard to case, so `budget` finds `Budget`.

## 3. Correct or forget it

- When a fact changes, ask your agent to remember the new one in place of the old. It calls `remember` with `replaces`, naming the old memory, and recall finds the new version from then on.
- When a fact no longer holds, ask your agent to forget it. It calls `forget`, and recall no longer finds it.
- When something must not be kept at all, ask your agent to erase it. It calls `forget` with `erase`, which also takes the text, the tags and the days out of the playbook's history, every version of it, and leaves who wrote it, when, and its links: the version each replaced and where it was moved from.

## 4. Remember and recall in a workflow

A workflow can recall what the playbook knows before a step, and remember what a step learns. Ask your agent:

```text
In my "<playbook name>" playbook, prepare a memory function that recalls what
the playbook and its organization keep about <a tag>, and a workflow that
recalls it and gives it to the "<reasoning function name>" function, each with
its page. Read Auto's memory-function guide first. Show me the documents before
saving them.
```

A memory function has a `recall` block, which answers memories, or a `remember` block, which keeps one from its input. Its `page` shows what each run recalled or kept, as [Its page](../reference/memory-format.md#its-page) says. A reasoning function reads what a recall answered with the `memories` filter, which marks each memory as recalled data rather than an instruction:

```markdown
---
description: Recalls the budget rules the organization keeps
recall:
  tags: [budgets]
  scope: organization
page:
  result: |
    {% assign found = output.memories | size %}Recalled {{ found }} budget {% if found == 1 %}rule{% else %}rules{% endif %}.

    {% for memory in output.memories -%}
    - {{ memory.text }}
    {% endfor %}
---
```

Run the workflow, then check the prompt that the reasoning function's run recorded: it holds each memory in a `memory` tag.

## Moving a memory

A memory kept by the playbook that turns out to be about the whole team can move to the organization. Auto Studio moves it as a new memory under a new id, and the memory moved stays in the history as moved.

## If something goes wrong

- **Recall finds nothing.** A memory must hold every word asked and have every tag asked. Ask with fewer words, or by a tag alone. A memory that expired, or was forgotten, is not recalled.
- **Remember is refused as `memories_full`.** The playbook, or its organization, already keeps 10,000 memories. Forget some first.
- **Remember is refused at a field.** A text holds 1 to 2,000 characters, a memory at most 8 tags, each lowercase letters, digits and hyphens, and an expiry runs from `P1D` to `P3650D`. The refusal names the field.
- **Replacing a memory is refused.** A memory forgotten, erased or moved takes no new version; the refusal says which. Remember the text as a new memory instead.

## Next

- [Memory function format](../reference/memory-format.md) has the document, the operations, how a recall matches and every bound.
- [Workflow format](../reference/workflow-format.md) describes calling a function from a workflow.

</div>
