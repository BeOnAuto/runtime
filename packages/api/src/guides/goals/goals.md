# Goals

The goals of a playbook say what it should achieve for the person and how they will know it worked. A playbook here needs its goals before anything else is made in it. You learn them from the person, you send them as the goals argument of create_playbook or update_playbook, you record the person's yes to them with agree_playbook_goals, and every workflow you save then says what it does for them.

<!-- with messages -->

The goals also say what the person wants to be told about, and where.

<!-- end -->

<!-- without messages -->

Auto does not send messages about goals here yet. Whenever the person asks to be told about results, say that first, and that their results are in Studio, before you ask or offer anything about telling them. Say it even when a post in their channel is part of the work they ask for.

<!-- end -->

This guide is in the order you need it: the conversation first, then the format.

## Before you build anything, learn the goals with the person

Ask the person and wait for their answers. Use plain words and the person's own terms. Do not create the playbook, a function or a workflow until you have every answer below and the person has said yes to what you will save.

<!-- with messages -->

Ask first, then propose once. Put everything that is still missing to the person in one round of questions, and do not say a goal or a measure back to them while you ask. A person who has already said some of it is not asked it again. What is missing is most often what to tell them when it passes, fails or becomes overdue, or where and when to tell them.

<!-- end -->

<!-- without messages -->

Ask first, then propose once. Put everything that is still missing to the person in one round of questions, and do not say a goal or a measure back to them while you ask. A person who has already said some of it is not asked it again.

<!-- end -->

When your client has a tool for asking the person a question, ask every question of the round through it, up to as many in a call as the tool takes, and more calls for the rest. In Claude Code that tool is AskUserQuestion, which takes up to four questions, and in Codex it is request_user_input, which takes up to three; other clients name theirs differently. Offer two or three answers you would suggest for each, drawn from what the person has said about their business, even for a question only they can answer, such as which time zone their days are in, and leave room for an answer in their own words. Only when your client has no such tool, ask the round in text, in one message as a short numbered list.

<!-- with messages -->

Then write one proposal as an ordinary message to the person. Include: the goal in their words and its name; each measure with its target and the words for a pass and a fail; how and when it is measured; what you will tell them about results, when and where; what the work itself will post or send, and where; and the services it needs, saying which are connected. Say which name or number is your suggestion: their yes to the proposal takes it. End that message with this question: Did I get all that right? Yes, or tell me what to change. Ask it in the message, not through your client's question tool, since the person has to read the proposal before they answer. When their answer changes anything in the proposal, show them the changed proposal, end that message with the same question, and wait for their yes before you call create_playbook.

<!-- end -->

<!-- without messages -->

Then write one proposal as an ordinary message to the person. Include: the goal in their words and its name; each measure with its target and the words for a pass and a fail; how and when it is measured; what the work itself will post or send, and where; and the services it needs, saying which are connected. Say which name or number is your suggestion: their yes to the proposal takes it. End that message with this question: Did I get all that right? Yes, or tell me what to change. Ask it in the message, not through your client's question tool, since the person has to read the proposal before they answer. When their answer changes anything in the proposal, show them the changed proposal, end that message with the same question, and wait for their yes before you call create_playbook.

<!-- end -->

Create the playbook only after their yes to the proposal, and never earlier just to reach another tool; the Studio link isn't needed before it. Then record that yes as [After the create](#after-the-create-show-the-saved-goals-and-record-the-yes) says. Never change a goal to suit how you built something.

1. **What the playbook should achieve for them.** Ask what change they want from it. Their words for it, in one sentence, are the goal's statement: save their sentence, not your rewording of it. A statement that only repeats the playbook's name or description is refused, so the description says what the playbook does, not this sentence.
2. **What to call it.** A short name for the goal, two to four words from their own, such as "Catering replies" or "Daily controls". That is the goal's `name`, the title the person sees it under. Suggest one in the proposal, even when the person has said everything else.
3. **How they will know it worked.** Ask what would convince them. That is one number and a target, such as at least one paying customer from each experiment, or no failing control in a day. The number is the one they said they would judge by, in their unit: "within 24 hours" is the hours it took, at most 24, not a count of replies. If you cannot measure that, say so and ask; never measure something easier instead. When they have no number in mind, the proposal suggests one that fits what they said. Ask too what to call a pass and a fail in their words, such as "Brought a customer" and "Brought no customer". When it is judged day by day and the work happens on some days only, such as working days, ask which days.

<!-- with messages -->

4. **What they want to be told, and where.** For each of these, ask whether they want to be told immediately, in a summary on a schedule, or not at all, which the goals save as `now`, `summary` and `quiet`:
   - when it passes;
   - when it fails;
   - when it becomes overdue: the time to judge came and no final measurement was reported.

   If they also want a summary, it lists every result, whichever they choose. Then ask where to tell them (a channel or an address), and, if they want a summary, how often it should be sent and when. Ask which time zone they mean when a time or a day matters: a summary's time, or a calendar day or week.

<!-- end -->

<!-- without messages -->

Auto does not send messages about goals here yet. Do not ask the person whether, when or where they want to be told about results, and do not offer it. Leave `notify` out of the goals and make no notification function. They see their results in Studio. If they ask to be told, or say when they do or don't want to hear about it, first say that Auto doesn't send messages about goals yet and that their results are in Studio. Only then may you offer to build the post into the playbook as ordinary work, and build it only after they say yes to that. Ask which time zone they mean when a day or a week matters.

<!-- end -->

More questions shape the goal when the work comes as a stream of things:

- **Is it judged thing by thing?** Experiments, invoices, tickets and orders are each judged on their own. Ask what one of them is called. That word is the goal's `per`. It is the person's own word, never one Auto uses for its own parts (run, workflow, step, event, function, job): they read it as the name of their thing all over Studio.
- **How often does one happen?** Each judged thing is a row the person reads. Work that happens many times a day, such as a check every minute, is judged by the day or the week unless the person asks for each one to be judged. Say back what they will see, such as "one result a day: how many of the day's checks passed", before you save.
- **What happens to one of them, start to finish, and which of those are theirs?** These are the goal's milestones, three to seven of them, each an event that really happens, named as what happened, such as "Launched" or "Result in". Fewer true milestones beat more hopeful ones. A milestone the person does needs a request that asks them and marks it on their answer; with nothing asking them, leave it out. They can answer any request in Studio, so one held for an agent, `deliver: agent`, asks them there with no connection. Each one is a segment of the goal's ring in Studio.

<!-- with messages -->

For example, a compliance owner says: "Tell me nothing when the daily checks pass. Tell me at once in the compliance channel when one fails, or when a day goes by and the check never reported. And send me a note every Friday at nine in the morning." That is passed `quiet`, failed `now`, overdue `now`, through the function that posts in that channel, and a summary every Friday at 09:00. Two things are still missing, so ask them: which channel, and which time zone their days and their nine in the morning are in.

<!-- end -->

<!-- without messages -->

For example, a compliance owner says: "Tell me at once when a daily check fails, and nothing when they pass." Say first that Auto doesn't send messages about goals yet and that the results will be in Studio. Then learn the goal behind the wish: every control passes its daily check, judged by the day, with at most zero failing controls. The statement says what should be achieved, never how they hear about it. One thing is still missing, so ask it: which time zone their days are in. Then suggest "Daily controls" as its name in the proposal. If they still want a post in their channel, offer to build it into the playbook, and build it only after their yes.

<!-- end -->

## Never invent a goal

<!-- with messages -->

Save only what the person said or agreed to. Do not fill in a statement, a name, a target, verdict words or a choice of what to be told because the format asks for it. A measure, a word or a time you suggested counts only once they say yes to it.

<!-- end -->

<!-- without messages -->

Save only what the person said or agreed to. Do not fill in a statement, a name, a target or verdict words because the format asks for it. A measure, a word or a time you suggested counts only once they say yes to it.

<!-- end -->

When the runtime refuses or answers with words that begin "Ask the person:", the rest is a question for the person. Put it to them, in your words if theirs would be clearer, through your client's question tool where it has one, as above, and send what they answer. It is not a puzzle to solve alone, and guessing an answer saves a goal the person never had.

<!-- with messages -->

create_playbook without goals is refused this way: "Ask the person: What should this playbook achieve for you, and how will you know it worked?" A goal that is still missing something only the person knows comes back the same way, each missing thing its own question: what change they want, what would convince them, when to tell them, where, and how often the summary is sent.

<!-- end -->

<!-- without messages -->

create_playbook without goals is refused this way: "Ask the person: What should this playbook achieve for you, and how will you know it worked?" A goal that is still missing something only the person knows comes back the same way, each missing thing its own question.

<!-- end -->

Never record a yes the person did not give. agree_playbook_goals is their answer in the conversation, not a step you take to get past a refusal or a gap.

## After the create, show the saved goals and record the yes

The answer of create_playbook holds `studio`, a link that opens the lead goal in Studio, and `goals`, the goals as saved with each goal's `version`. Give the person the link, so that they can see what was saved. When the saved goals are the ones they said yes to, unchanged, record that yes with agree_playbook_goals, naming each goal with its `version` as saved, without asking again. When anything changed, show them what changed and the link in one message, and end it with the same question: Did I get all that right? Yes, or tell me what to change.

Change the goals with update_playbook until they say yes. A save that changes a goal answers with a new `version` for that goal, and update_playbook's answer carries no `studio` link, so say the changed goals back in their words.

agree_playbook_goals records their yes to the goals you name in `goals`; name every goal they said yes to, and leave out any they did not. Build nothing before that call: no function and no workflow.

A yes holds only for the goals as the person saw them. A save that changes a goal, its name included, drops the yes to that goal. So after the yes, put a change to the person first, save it as they agreed it, and call agree_playbook_goals again with that goal's new version before you build on it. When the call answers that a goal changed since the version you gave, show the person that goal as it is saved and ask before you record a yes.

<!-- with messages -->

The answers of create_playbook, update_playbook and get_playbook carry `goals`: the text as saved, each goal's version and the gaps. A gap is not a refusal. It says what the goals still lack before they can be judged or told, such as a measure that no workflow reports yet. Most gaps close as you save the workflows and the notification function. [Gaps, and who fixes each](#gaps-and-who-fixes-each) lists them.

<!-- end -->

<!-- without messages -->

The answers of create_playbook, update_playbook and get_playbook carry `goals`: the text as saved, each goal's version and the gaps. A gap is not a refusal. It says what the goals still lack before they can be judged, such as a measure that no workflow reports yet. Most gaps close as you save the workflows. [Gaps, and who fixes each](#gaps-and-who-fixes-each) lists them.

<!-- end -->

The answers of create_playbook, update_playbook, create_definition and update_definition can also carry `notices`: what to double-check in what you just saved, such as a `per` that is one of Auto's own words, and what the person will see. Read each before you go on: change what you saved, or carry on as `before_going_on` says.

<!-- without messages -->

The same holds when you plan the work after the yes. If the person asked to be told about results, your first words about it are that Auto doesn't send messages about goals yet and that their results are in Studio. Only then ask whether they want a post built into the playbook, and where. Never ask it if they didn't ask to be told.

<!-- end -->

## The goals argument

The goals argument is text: the list of goals alone, with no key around it, written the way a workflow document is written. Send the whole list every time. update_playbook replaces the list with the one you send.

- At most 8 goals and 16,384 bytes. One goal is often enough. The first is the lead goal: it orders the person's cards and leads the link.
- A goal that has been judged cannot be left out. Stop it with `retired: true`, which keeps its id and record and can be undone. A goal that was never judged may simply be left out.
- A goal's `id` is not changed in the list: an id the playbook does not have is a new goal. Give a goal a new id with `rename_goal`; see [Renaming a goal](#renaming-a-goal).
- A goal's `per`, the kind of its window, a calendar window's unit and time zone, and `settles` cannot change once saved under that id. A different shape is a new goal with a new id. Anything else may change, and a change applies to judgings that open afterward.

<!-- with messages -->

| Key               | Required                                      | What it holds                                                                                                                                     |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Yes                                           | A lowercase letter, then 2 to 47 lowercase letters, digits and hyphens; unique in the playbook. Make it from the name, such as `catering-replies` |
| `name`            | No; suggest one in the proposal               | The goal's short name in the person's words, two to four words, 2 to 40 characters                                                                |
| `statement`       | Yes                                           | The person's words for what it should achieve, 12 to two hundred characters                                                                       |
| `per`             | No                                            | What one thing is called, a singular noun of 2 to 40 characters; the goal is then judged thing by thing                                           |
| `window`          | No                                            | The stretch of time one judging covers: `after` with `for`, or `calendar`; see below                                                              |
| `success.label`   | Yes                                           | The words for the number, 2 to two hundred characters                                                                                             |
| `success.settles` | Yes                                           | `on_crossing` or `at_close`; see [Choosing settles](#choosing-settles)                                                                            |
| `success.target`  | Yes                                           | Exactly one of `at_least` and `at_most`, a finite number                                                                                          |
| `success.passed`  | Yes                                           | The person's word for a pass, 2 to 40 characters                                                                                                  |
| `success.failed`  | Yes                                           | The person's word for a fail, 2 to 40 characters                                                                                                  |
| `milestones`      | No                                            | None, or 3 to 7, each `id`, `label` (2 to 80 characters) and `by`, `person` or `auto`                                                             |
| `notify.passed`   | Yes                                           | `now`, `summary` or `quiet`                                                                                                                       |
| `notify.failed`   | Yes                                           | `now`, `summary` or `quiet`                                                                                                                       |
| `notify.overdue`  | With a window                                 | `now`, `summary` or `quiet`: what to do when it becomes overdue                                                                                   |
| `notify.through`  | When any of them is `now`                     | The name of the notification function that tells the person                                                                                       |
| `notify.summary`  | When any of them is `summary`; allowed always | `cron`, five fields; `time_zone`, UTC by default; `through`, `notify.through` by default                                                          |
| `retired`         | No                                            | `true` stops the goal and ends its open judgings without a verdict                                                                                |

<!-- end -->

<!-- without messages -->

| Key               | Required                        | What it holds                                                                                                                                     |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Yes                             | A lowercase letter, then 2 to 47 lowercase letters, digits and hyphens; unique in the playbook. Make it from the name, such as `catering-replies` |
| `name`            | No; suggest one in the proposal | The goal's short name in the person's words, two to four words, 2 to 40 characters                                                                |
| `statement`       | Yes                             | The person's words for what it should achieve, 12 to two hundred characters                                                                       |
| `per`             | No                              | What one thing is called, a singular noun of 2 to 40 characters; the goal is then judged thing by thing                                           |
| `window`          | No                              | The stretch of time one judging covers: `after` with `for`, or `calendar`; see below                                                              |
| `success.label`   | Yes                             | The words for the number, 2 to two hundred characters                                                                                             |
| `success.settles` | Yes                             | `on_crossing` or `at_close`; see [Choosing settles](#choosing-settles)                                                                            |
| `success.target`  | Yes                             | Exactly one of `at_least` and `at_most`, a finite number                                                                                          |
| `success.passed`  | Yes                             | The person's word for a pass, 2 to 40 characters                                                                                                  |
| `success.failed`  | Yes                             | The person's word for a fail, 2 to 40 characters                                                                                                  |
| `milestones`      | No                              | None, or 3 to 7, each `id`, `label` (2 to 80 characters) and `by`, `person` or `auto`                                                             |
| `retired`         | No                              | `true` stops the goal and ends its open judgings without a verdict                                                                                |

<!-- end -->

The window:

- `after` names a milestone. The window starts when that milestone is first marked for the thing, and closes `for` later. A run marks as it ends, so mark the start in a run that does not wait for the person.
- `calendar` is `day`, `week` or `month`, in `time_zone` (UTC by default; the same time zone names a workflow's `cron` takes). A week starts on Monday. A calendar window is not allowed together with `per`.
- `days` lists the days of the week a `calendar: day` window is judged on, such as `[monday, tuesday, wednesday, thursday, friday]`. The other days have no window, so nothing is judged or missed on them. Leave it out to judge every day.
- `grace` is how long after the close a final measurement may still arrive. It is one hour, `PT1H`, by default. Its verdict can come that much later, so put any grace you choose to the person with the window, as you would a target.
- `for` and `grace` are exact lengths of weeks, days, hours and minutes, from `PT1M` to `P90D`, such as `P7D` or `PT8H`.
- A goal with no window is judged only when a measurement crosses its target, and never becomes overdue.

<!-- with messages -->

A summary may not come more often than once an hour. It is sent at each time of its `cron` even when nothing happened, so it also tells the person the playbook is still working.

<!-- end -->

### A goal judged thing by thing, with milestones

<!-- with messages -->

An owner runs experiments to win customers. Each experiment is judged on its own, over the seven days after it goes live, and passes as soon as it brings one paying customer. She wants to be told immediately about every outcome, and a summary every Friday.

<!-- end -->

<!-- without messages -->

An owner runs experiments to win customers. Each experiment is judged on its own, over the seven days after it goes live, and passes as soon as it brings one paying customer.

<!-- end -->

```
- id: paying-customers
  name: Paying customers
  statement: Bring in paying customers through my experiments.
  per: experiment
  window:
    after: live
    for: P7D
    grace: P1D
  success:
    label: New paying customers traced to the experiment
    settles: on_crossing
    target: { at_least: 1 }
    passed: Brought a customer
    failed: Brought no customer
  milestones:
    - { id: chosen, label: Idea chosen, by: person }
    - { id: prepared, label: Package prepared, by: auto }
    - { id: live, label: Launched, by: auto }
    - { id: measured, label: Result in, by: auto }
<!-- with messages -->
  notify:
    passed: now
    failed: now
    overdue: now
    through: tell-owner
    summary: { cron: '0 9 * * 5' }
<!-- end -->
```

### A goal judged on a calendar

The compliance owner from the start of this guide. Each day is judged on its own and fails as soon as a control fails. A day becomes overdue when its check never reported everything.

```
- id: daily-controls
  name: Daily controls
  statement: Every control passes its daily check.
  window: { calendar: day, grace: PT1H }
  success:
    label: Failing controls
    settles: on_crossing
    target: { at_most: 0 }
    passed: All controls held
    failed: A control failed
<!-- with messages -->
  notify:
    passed: quiet
    failed: now
    overdue: now
    through: tell-owner
    summary: { cron: '0 9 * * 5' }
<!-- end -->
```

<!-- with messages -->

This one is in UTC. Ask for the person's time zone before you save it and give it as `time_zone` in both the window and the summary. A calendar window's time zone cannot change once the goal is saved, so a different one needs a new goal id; the summary's can change at any time.

<!-- end -->

<!-- without messages -->

This one is in UTC. Ask for the person's time zone before you save it and give it as the window's `time_zone`. A calendar window's time zone cannot change once the goal is saved, so a different one needs a new goal id.

<!-- end -->

### Choosing settles

A running total, or a "never above", is `on_crossing`: it passes or fails as soon as a measurement crosses the target. A ratio, an average, or "by the end of the week" is `at_close`: it is judged once, at the close, from the final measurement. `at_close` needs a window.

How a judging ends:

<!-- with messages -->

- With `on_crossing` and `at_least`, a measurement at or above the target while the window is open passes immediately. With `at_most`, a measurement above it fails immediately.
- At the close plus its grace, the latest final measurement decides, for both kinds of `settles`.
- When no final measurement has arrived by then, the judging becomes overdue. A final measurement whose `as_of` lies at or before the window's close still decides it when it arrives. A measurement with no `as_of` is true as of when its run ended.
- A final measurement whose `as_of` lies after the close is late. A late one that misses the target fails the judging with that number once the close and its grace have passed: a reply that took 23 hours against at most 8 is a miss that reads 23. A late one that meets the target never makes a pass: the judging stays overdue and keeps it as its number.
- A judging still overdue one more window later fails, since its deadline passed with nothing that counts. A final measurement that arrives after that becomes its number, and it stays a miss. So tell the person that a thing nothing measured, such as one waiting on an answer that never came, shows overdue once its close and grace pass, and is missed only one window later.
- A verdict is final. Later measurements never change it, though milestones are still marked.

<!-- end -->

<!-- without messages -->

- With `on_crossing` and `at_least`, a measurement at or above the target while the window is open passes immediately. With `at_most`, a measurement above it fails immediately.
- At the close plus its grace, the latest final measurement decides, for both kinds of `settles`.
- When no final measurement has arrived by then, the judging becomes overdue. A final measurement whose `as_of` lies at or before the window's close still decides it when it arrives. A measurement with no `as_of` is true as of when its run ended.
- A final measurement whose `as_of` lies after the close is late. A late one that misses the target fails the judging with that number once the close and its grace have passed: a reply that took 23 hours against at most 8 is a miss that reads 23. A late one that meets the target never makes a pass: the judging stays overdue and keeps it as its number.
- A judging still overdue one more window later fails, since its deadline passed with nothing that counts. A final measurement that arrives after that becomes its number, and it stays a miss. So tell the person that a thing nothing measured, such as one waiting on an answer that never came, shows overdue once its close and grace pass, and is missed only one window later.
- A verdict is final. Later measurements never change it, though milestones are still marked.

<!-- end -->

## Renaming a goal

To change what a goal is called for the person, change its `name` in the list and ask for their yes, as for any change. To change its `id`, call update_playbook with `rename_goal` alone: the `id` it has and the `new_id`. The goal keeps its results and the person's yes, and each workflow that serves it gets a new version that names the new id, so write the new id in `contributes` from then on. A rename is refused while one of those workflows has a run that has not ended. Change an `id` when the person asks for it, or when a move was refused because the other playbook already has a goal of that id.

## What a workflow contributes

Once a playbook has goals, every workflow you save says what it does for them, in a top-level `contributes` list beside `document`, `schedule` and `do`. A workflow without it is refused, and so is one that names a goal or a milestone the playbook does not have.

Each entry reads the run's output when the run ends. Pointers start with a slash and name a field of the output, such as /failed for the field failed.

| Key        | Required                | What it holds                                                                                                                  |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `goal`     | Yes                     | The id of a goal of the playbook that is not retired                                                                           |
| `purpose`  | Yes                     | One sentence, in the person's words, of what this workflow does for the goal                                                   |
| `each`     | No                      | A pointer to a list in the output: each item is one thing, and the other pointers and `when` read the item. Only with `per`    |
| `per_id`   | When the goal has `per` | A pointer to the id of the thing: text or a number                                                                             |
| `title`    | No                      | A pointer to the thing's title                                                                                                 |
| `link`     | No                      | A pointer to a link to the thing                                                                                               |
| `when`     | No                      | One `${ }` expression over `$data`; the entry counts only when it is true                                                      |
| `marks`    | No                      | The id of the milestone this run marks                                                                                         |
| `measures` | No                      | A pointer to the measurement the goal is judged by                                                                             |
| `final`    | No                      | A pointer to true or false, or `true`: this measurement will not change any more for its window. Needs `measures` and a window |
| `as_of`    | No                      | A pointer to the instant the measurement is true through, with its offset; when the run ended, if left out. Needs `measures`   |
| `says`     | No                      | A pointer to one sentence of evidence the person reads, at most two hundred characters                                         |

- `title` is the name the person would call the thing, such as "Cold email batch to dental clinics": they read it in every list and heading. Never an id, a run id or a UTC time. The same holds for `says` and for every question a request puts to the person: dates and times in words in the person's time zone, such as "Tuesday, November 17 at 9:20 AM", a name rather than an email address, and no id. A thing with no name a person would use is probably not the thing to judge.
- `says` is what the person reads about the thing in Studio: one plain sentence, written for them and not as a log line, with the numbers and the names of what is missing or failed, such as "9 of 14 checks reported. Missing: the backup restore test and the audit trail."
- Give `link` wherever the thing lives somewhere the person can open.
- `marks` ticks a milestone only for a thing it really happened to, so its `when` must be true for that thing.
- At most 8 entries. One workflow may serve several goals, or one goal several ways.
- An entry whose `when` is false, whose `each` is empty, or whose `per_id` finds nothing, records nothing, silently.
- `each` takes at most a hundred items, and names each thing once.
- Every milestone of a goal, and its measure, need a workflow that marks or reports them. Until one does, the goal shows a gap.
- A thing whose run fails, or whose final measurement can no longer meet an `on_crossing` target, shows as stopped in Studio, with the run's reason. It stays open and is judged at its due time; a later run that marks its next milestone, or a measurement that is not final, clears it. A failed run reaches only a thing marked or measured by a run it follows from, such as the run whose event started it, or, when its workflow contributes to the goal, by a run the same outside event started. So if preparing the package were its own workflow, started by an event the Monday workflow publishes once the idea is chosen, its failure would show that experiment as stopped with the reason; a run started by its schedule, or one that fails before anything marked the thing, stops nothing.
- When the person says a thing no longer needs them, dismiss it with dismiss_goal_thing, by its goal and id from the about of a request in list_interactions. It leaves its goal's Outstanding in Studio for everyone in the organization, and list_interactions leaves its requests out unless asked with dismissed: include, as Studio does. Dismissing is only for a clear "this no longer needs us". Words like "ignore it" or "forget that one" could be an answer, a correction or a wish to cancel: before you call dismiss_goal_thing, ask whether they mean the thing no longer needs them, and send an answer with answer_interaction. A dismissed thing's requests still wait and can be answered until they expire, and the thing is still judged and counts toward the goal. Before you dismiss several things, name each to the person, say they leave for everyone, and wait for their yes to that list; asking for "all of them" or "everything" is not that yes. Dismiss only what the person asked you to. To restore a dismissed thing, take its goal and id from list_interactions with dismissed: include, or from a thing.dismissed event of list_playbook_events, and call dismiss_goal_thing with dismissed: false.

### final and as_of

`final` says the measurement will not change any more for its window. The day's one complete check is final. A count taken while the window is still open is not, and neither is a check in which something did not report. A goal whose window closes with no final measurement becomes overdue, so give the workflow that knows the measurement is complete a `final`.

`as_of` is the instant the measurement is true through. A window holds the measurements whose `as_of` lies after it opens and at or before it closes, so a total measured through the close belongs to the window it closes. A window that starts `after` a milestone also counts the measurement reported by the run that first marks that milestone, whatever its `as_of`: one workflow may mark the milestone and report the first number in the same run, even when its `as_of` is the moment it read its source. A measurement reported by an earlier run is progress and decides nothing. Leave `as_of` out when the run measures the moment it runs. Give it when a run on Monday reports last week.

### The contributions for the experiments

Two workflows serve the experiments goal. The first starts every Monday, asks the owner which idea to try next and prepares its package. Its output holds the chosen idea's `issue_id`, `title` and `issue_url`, `chosen` once the owner has answered, and `prepared` once the package is ready.

```
schedule:
  cron: '0 9 * * 1'
contributes:
  - goal: paying-customers
    purpose: Asks which idea to try next.
    per_id: /issue_id
    title: /title
    link: /issue_url
    when: ${ $data.chosen === true }
    marks: chosen
  - goal: paying-customers
    purpose: Prepares the package for the chosen idea.
    per_id: /issue_id
    when: ${ $data.prepared === true }
    marks: prepared
```

The second starts every hour and reads the tracker; choose a schedule from how often the source changes and how soon the person needs to know. Its output holds `experiments`, one item for each experiment, with its `id`, `title`, `url`, `live`, `customers`, `closed`, `measured_through` and `evidence`.

```
schedule:
  every: PT1H
contributes:
  - goal: paying-customers
    purpose: Sees when an experiment goes live.
    each: /experiments
    per_id: /id
    when: ${ $data.live === true }
    marks: live
  - goal: paying-customers
    purpose: Counts the customers each experiment brought in.
    each: /experiments
    per_id: /id
    title: /title
    link: /url
    measures: /customers
    final: /closed
    as_of: /measured_through
    says: /evidence
  - goal: paying-customers
    purpose: Marks an experiment measured once its window has closed.
    each: /experiments
    per_id: /id
    when: ${ $data.closed === true }
    marks: measured
```

### The contribution for the daily checks

One workflow serves the controls goal. It starts at 09:00 every day and checks every control. Its output holds `failed`, the number of failing controls, `all_reported`, true when every control answered, and `summary`, one sentence.

```
schedule:
  cron: '0 9 * * *'
contributes:
  - goal: daily-controls
    purpose: Checks every control once a day.
    measures: /failed
    final: /all_reported
    says: /summary
```

<!-- with messages -->

## The notification function

Auto sends the person a message when a goal passes, fails or becomes overdue, and a summary on the goal's schedule. The runtime calls such a message a notice, as in the gap kinds that begin `notice_`; say "message" to the person.

`notify.through` and `summary.through` name an interaction function that sends a notification: it has no answer, as the interaction-function guide says. One function can send both a message and a summary. Each run's input holds these fields:

| Field      | What it holds                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `change`   | `passed`, `failed`, `overdue` or `summary`                                                                                                                                       |
| `headline` | One line, such as "A control failed: Every control passes its daily check."                                                                                                      |
| `detail`   | The evidence or the measurement, absent from a message that has neither, such as one that becomes overdue with nothing reported; for a summary, its lines as text, one to a line |
| `link`     | The goal in Studio, absent where the runtime does not know Studio's address                                                                                                      |
| `owner`    | `id` and `name` of the playbook's owner                                                                                                                                          |
| `goal`     | `id` and `statement`                                                                                                                                                             |

The input of a message can also carry `per`, `window`, `measure` and `says`, and that of a summary `window`, `counts`, `lines` and `more`. A function whose text reads only `headline`, `detail` and `link`, reads `detail` and `link` only inside `{% if %}`, since either can be absent, and asks for no field beyond the six above, takes every message and every summary. Give it no input rules of its own, or none that a summary would fail.

Its own `to` decides who is told. Give it at least an hour before it expires, so that every attempt to deliver has time. Learn the sending tool as the interaction-function guide says, then save it with create_definition, type interaction:

```
---
description: Tells the compliance owner about the daily checks in the team chat
to: '#compliance'
expires: PT4H
deliver:
  server: chat
  tool: post_message
  with:
    channel: '{{ to }}'
    text: '{{ message }}'
---
{{ input.headline }}
{%- if input.detail %}

{{ input.detail }}
{%- endif %}
{%- if input.link %}

{{ input.link }}
{%- endif %}
```

Keep the function active. A paused or retired one sends nothing, and the goal shows a gap. A message or a summary costs nothing, and a playbook sends at most two hundred of them in a UTC day.

<!-- end -->

## Older playbooks

A playbook made before goals keeps running as it is. The next time you save one of its workflows, create_definition or update_definition refuses it with "Ask the person: What should this playbook achieve for you, and how will you know it worked?" Then:

1. Learn the goals with the person, as above.
2. Send the goals with update_playbook once they say yes to the proposal, and record that yes with agree_playbook_goals, naming each goal with its `version` as saved, as above. update_playbook's answer carries no `studio` link.
3. Save the workflow again, with its `contributes`.

Its other workflows keep running, and each shows as a gap until you next save it with a contribution.

## Which runs count

These runs count as evidence: a workflow's `cron` or `every`, a run the person starts in Studio, a run you start or an event you publish, signed in as the person or with an API key, and the runs, events and requests that follow from those. A run is a test only when started with run_definition and `test: true`; it never counts, nor anything that follows from it. A test still does real work: it calls tools, asks people, sends messages and changes things outside the playbook, as any run does. It only keeps the runs from counting.

<!-- with messages -->

When you run a goal's workflow to try it, pass `test: true`; to do the real job, leave it out. Without it the run counts: it can open a judging and send the person a message, and a judged thing cannot be taken back. The answer of a run you start that counts says so. A test run that succeeds shows the workflow ran, not the goal judged: tell the person the next run that counts, such as the schedule's, can open the first judging, and show them the `studio` link to watch for it.

<!-- end -->

<!-- without messages -->

When you run a goal's workflow to try it, pass `test: true`; to do the real job, leave it out. Without it the run counts: it can open a judging, and a judged thing cannot be taken back. The answer of a run you start that counts says so. A test run that succeeds shows the workflow ran, not the goal judged: tell the person the next run that counts, such as the schedule's, can open the first judging, and show them the `studio` link to watch for it.

<!-- end -->

A person's own milestone is marked when they answer a request inside a run that counts. The run waits for their answer, its output then carries what they said, and the contribution's `marks` and `when` read it. That is how the experiments workflow above marks `chosen`. A milestone Auto only sees happen, as the hourly workflow sees an experiment go live, is `by: auto`.

## Gaps, and who fixes each

Each gap carries `kind`, `detail` and `fixed_by`. Where `fixed_by` is `person`, it also carries `ask`: put that question to the person. Where it is `agent`, the detail says what to change, and you change it.

<!-- with messages -->

| Kind                            | Who    | What to do                                                                                          |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `no_goal`                       | Person | Learn the goals with the person, send them with update_playbook and record their yes                |
| `no_milestones`                 | Person | Ask what has to happen to one thing, start to finish, and which steps are theirs                    |
| `connection_missing`            | Person | Put its `ask` to the person: `Connect <server> in Studio`                                           |
| `measure_unreported`            | Agent  | Give a workflow a contribution with `measures`                                                      |
| `measure_paused`                | Agent  | Resume a paused workflow that reports it, or let an active one report it                            |
| `measure_never_final`           | Agent  | Give the workflow that knows the measurement is complete a `final`                                  |
| `milestone_unmarked`            | Agent  | Give a workflow a contribution that `marks` the milestone                                           |
| `window_never_starts`           | Agent  | Mark the milestone the window starts `after`                                                        |
| `workflow_without_contribution` | Agent  | Save the workflow again with `contributes`                                                          |
| `contribution_orphaned`         | Agent  | Save the workflow again, naming a goal and milestones the playbook still has                        |
| `notice_function_missing`       | Agent  | Save the notification function that `through` names, after asking the person where to tell them     |
| `notice_not_started`            | Agent  | Read the detail: resume the function, or fix what refused the message; the daily limit needs no fix |
| `notice_undelivered`            | Agent  | Read the function's last run, and fix its delivery or its expiry                                    |
| `observation_refused`           | Agent  | Read the detail, and fix the workflow's output or its contribution                                  |

<!-- end -->

<!-- without messages -->

| Kind                            | Who    | What to do                                                                           |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `no_goal`                       | Person | Learn the goals with the person, send them with update_playbook and record their yes |
| `no_milestones`                 | Person | Ask what has to happen to one thing, start to finish, and which steps are theirs     |
| `connection_missing`            | Person | Put its `ask` to the person: `Connect <server> in Studio`                            |
| `measure_unreported`            | Agent  | Give a workflow a contribution with `measures`                                       |
| `measure_paused`                | Agent  | Resume a paused workflow that reports it, or let an active one report it             |
| `measure_never_final`           | Agent  | Give the workflow that knows the measurement is complete a `final`                   |
| `milestone_unmarked`            | Agent  | Give a workflow a contribution that `marks` the milestone                            |
| `window_never_starts`           | Agent  | Mark the milestone the window starts `after`                                         |
| `workflow_without_contribution` | Agent  | Save the workflow again with `contributes`                                           |
| `contribution_orphaned`         | Agent  | Save the workflow again, naming a goal and milestones the playbook still has         |
| `observation_refused`           | Agent  | Read the detail, and fix the workflow's output or its contribution                   |

<!-- end -->
