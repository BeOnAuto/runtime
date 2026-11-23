---
description: Connect Slack to Auto, use messages, channels and threads in a playbook, and remove the connection when you no longer want it.
---

# Connect Slack

Connect Slack to Auto, so that the functions in your playbooks can read messages, channels and threads, look up people, and send messages and add reactions. Your agent does the setup, and you allow access at Slack.

On Auto Cloud, Slack connects through Auto's own Slack app, and a playbook reads and posts as @Auto, as [On Auto Cloud](#on-auto-cloud) shows. On an Auto that you or your company runs, a playbook uses a Slack app of your own, as [Use your own Slack app](#use-your-own-slack-app) shows.

## On Auto Cloud

Slack connects through Auto's own Slack app. A function in your playbook reads public channels, private channels @Auto has been added to and @Auto's direct messages with people, and sends messages and adds reactions as @Auto. It doesn't read your own direct messages or channels @Auto isn't in, and its messages aren't sent under your name. Only an admin of your organization can connect Slack or remove it. An editor asks an admin to connect it with **Request**.

To connect it, ask your agent to connect Slack, or open **Settings**, then **Connections** in Studio, select **Slack** under **Add a connection**, and select **Continue to Slack**. Allow access at Slack. In a private channel a playbook uses, send `/invite @Auto`.

People of your organization can then write to @Auto in Slack. @Auto recognizes a member by the email address they use in Slack, when it's the one they use in Auto, and asks anyone else to connect their Auto account. Auto reads that address only to compare it.

Auto answers members with a model it picks, until an admin chooses one. An admin can choose it under **Model** as they connect Slack, or later on the Slack connection's **Model** line in **Settings**, **Connections**.

### A Slack connection made before

A Slack connection made as yourself, before Slack connected through @Auto, stops working: playbooks can't use it. Its row in Studio's Connections shows **Needs attention** and says "Slack now connects through @Auto. Reconnect to keep your playbooks working."

1. Select **Reconnect** on its row. Only an admin of your organization can.
2. Allow access at Slack.

Auto removes the old connection and adds the new one under the same name, for the same playbooks, so your playbooks keep their Slack steps. As soon as you select **Reconnect**, Auto forgets the old connection's tokens and stops renewing them, so it can never use them again. Nothing needs doing at Slack.

## Use your own Slack app

On Auto Cloud most people don't need this, and connect Slack as [On Auto Cloud](#on-auto-cloud) shows. Your own Slack app is for an Auto that you or your company runs, a workspace on Slack's free plan, or a company that wants playbooks to use an app it owns.

Auto's Slack app works only in workspaces on a paid Slack plan, as Slack requires of [apps that connect Slack to an automation platform](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements#automation-platform-apps). In a workspace on the free plan, Auto says "A paid Slack plan is required" and isn't added. You then have two choices:

- Upgrade the workspace in Slack, then connect again.
- Create a Slack app of your own, as below. It counts toward the free plan's limit on apps. [Slack's help](https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-plan) says: "On the free version of Slack, you'll be limited to 10 third-party or custom app installations."

### How your own app differs from Auto's

Your company creates the app at Slack and owns it. Auto connects to it as Slack Bot, with the app's bot token, a code Slack gives the app when it is installed. A playbook can then do what [Use Slack in a playbook](#use-slack-in-a-playbook) lists, with these differences:

- Your app reads and posts only in the channels you add it to.
- Messages come from your app, under its name. An app made with **Create your Slack app** is named Auto.
- On an Auto that you or your company runs, members can write to your app in Slack once you give it your app's app-level token, as [Talk to @Auto through your app](#talk-to-auto-through-your-app) shows. On Auto Cloud, talking to Auto takes Auto's Slack app.
- On an Auto that you or your company runs, Slack tells Auto when someone replies to a request, once you give it your app's app-level token, as step 5 of [Create your app and connect it](#create-your-app-and-connect-it) shows. Without that token, and on Auto Cloud, Auto checks for replies on a timer: every few seconds at first, and every five minutes at most, as [Answering by reply](../reference/interaction-format.md#answering-by-reply) sets out.
- Slack's limit on reading a conversation, 15 messages a read and one read a minute, doesn't apply to your app.

### Create your app and connect it

One person does these steps: an admin of your organization in Auto, who also has a Slack account in the workspace. No code is needed. Where your workspace takes only the apps its owners approve, a workspace owner or app manager approves your app once.

1. Ask your agent:

   ```text
   Connect my own Slack app to Auto as Slack Bot, for my "<playbook name>" playbook.
   ```

   Or, in Studio, open **Settings**, then **Connections**, select **Slack Bot** under **Add a connection**, and select **Continue**.

2. Open the page of Studio your agent gives you, **Connect Slack Bot**. If you started in Studio, it opens by itself. The steps below follow the steps on that page.
3. Under **Create the app in Slack**, select **Create your Slack app**, signed in to Slack. Slack opens in a new tab with the app already filled in, named Auto. It shows the app's settings as a block of code, with two notices. That is expected: leave everything as it is, choose your workspace, then select **Next** and **Create**. If you made your app before, skip this step: open it at [api.slack.com/apps](https://api.slack.com/apps), select **OAuth & Permissions** and copy its token as step 4 says.
4. Under **Install the app and copy its token**, the page tells you what to do in Slack: select **OAuth & Permissions**, then **Install to Workspace** and **Allow**. Where your workspace takes only approved apps, Slack asks you to request the app instead, and you install it once it is approved. Copy the **Bot User OAuth Token**, which starts with `xoxb-`, and paste it on the page of Studio under **Slack bot token**. Keep it private: anyone who has it can act as your app.
5. On an Auto that you or your company runs, the page has one more step, **Get replies instantly**, marked **Optional**. With it, Auto gets replies the moment they're posted, instead of checking on a timer. The token also lets a workflow start when a message is posted in a channel your app is in, and lets members write to @Auto in Slack. Without it, Auto checks for replies on a timer, no workflow starts from a message, and members can't write to @Auto. In Slack, select **Basic Information**, then under **App-Level Tokens** select **Generate Token and Scopes**. Enter any name, add the scope `connections:write`, select **Generate**, then copy the token, which starts with `xapp-`, and paste it under **Slack app-level token**. On Auto Cloud the page doesn't have this step.
6. On an Auto that you or your company runs, an admin then sees **Talk to @Auto in Slack**, marked **Optional**. Once you've pasted the app-level token, choose the model Auto answers members with, under **Model**. The page then connects only once a model is chosen. If no model provider is set up on your Auto, the step says so, and whoever runs your Auto sets one up, as [Set up a model provider](../self-host/models.md) shows.
7. On the **Available to** line, select **Change**, then **All playbooks** or **Only select playbooks**. A playbook your agent asked for is already chosen, and you can change it.
8. Select **Connect**. Auto checks what you pasted with Slack before it saves it, and the page then says the connection is connected. If Slack refuses a token, the page says so under its field, and nothing is saved.
9. Under **One more thing, in Slack**, the page reminds you to add your app to each channel your playbooks use. In the channel, type `/invite @Auto` and send it. If your app has another name, type that name in place of Auto.

Auto keeps each token in its secret store, and your agent never sees it. Give a function in your playbook the Slack Bot tools as [Use Slack in a playbook](#use-slack-in-a-playbook) shows. To stop using your app, remove the Slack Bot connection as [In Auto](#in-auto) shows, and remove the app at Slack as [At Slack](#at-slack) shows. For help, see [Get help](#get-help).

On an Auto that you or your company runs, the server needs outgoing HTTPS and WebSocket connections on port 443 to `slack.com` and to the address Slack gives Auto for the connection, such as `wss.slack.com`. Nothing incoming is needed. If Auto can't reach an address when you select **Connect**, the page names it. If Auto's own settings limit the hosts connections may reach, whoever runs your Auto allows these hosts there too.

### Talk to @Auto through your app

On an Auto that you or your company runs, members of your organization can mention @Auto in a channel it's in, or send it a direct message. In a channel, Auto answers in the message's thread. This needs an Auto that signs people in, your app's app-level token (step 5) and a model an admin chose (step 6). Until a model is chosen, Auto answers nobody in Slack. An admin chooses or changes it on the Slack Bot connection's **Model** line in **Settings**, **Connections**. [Let members talk to @Auto in Slack](../self-host/production.md#let-members-talk-to-auto-in-slack) says what whoever runs your Auto sets up.

Only members of your organization can talk to @Auto, and Auto does only what each member's role allows. A viewer, for example, can't have it run or change anything.

@Auto recognizes a member by their email address, where Slack and your Auto's sign-in both say it's verified and it's the same address. Auto reads that address only to compare it, and doesn't keep it. Anyone else is asked, in a message only they see, to sign in to Auto:

1. They select **Sign in to Auto** and sign in.
2. The page asks "Connect your Slack account to Auto?", and they select **Allow**.
3. They send @Auto the code the page then shows.

Auto then says in Slack that their account is connected. To disconnect it later, they send @Auto `disconnect`.

Someone who isn't a member can still answer a request a playbook sends them, by replying in its thread, and nothing more. @Auto doesn't answer in channels shared with other organizations, where members message it directly instead.

## Use Slack in a playbook

Once Slack is connected, ask your agent to give a function in your playbook the Slack tools it needs, as [Give a function tools](../guides/tools.md) shows. Say what you want done, in your own words:

| A playbook can                                                                                           | You might ask                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Read the history of a channel and a thread                                                               | "Summarize yesterday's thread in the support channel about the delayed order."            |
| Look up people and channels                                                                              | "Find the channel about the trade show, and the job titles of the people who post there." |
| Send a message, and change one it sent                                                                   | "Post the weekly summary in the marketing channel."                                       |
| Add a reaction, and see the reactions on a message                                                       | "Add a check mark to each question in the support channel we answered today."             |
| Ask someone to approve in a channel. Auto marks their reply when it is taken, and says so when it is not | "Ask the campaign owner in the marketing channel to approve the brief."                   |

A request in Slack is answered by a reply in the thread of its message. When it asks a channel by its name, such as #paid-media, and your agent didn't name who answers, anyone who replies in that thread can answer it. To have one person answer, ask your agent to name them, and replies from others are then not taken. See [Answering by reply](../reference/interaction-format.md#answering-by-reply).

The `slack-bot` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Slack, through @Auto or your own app.

Searching Slack messages is not available yet.

[Slack limits](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) how an app distributed outside the Slack Marketplace reads a conversation, and Auto's Slack app is distributed outside it. Through it, a function gets at most 15 messages of the history of a channel, or of a thread, in each call, however many it asks for, and reads more by calling again with the cursor Slack returned. Slack also allows such an app one of these reads a minute in each workspace. It answers a read past that limit with how long to wait, and the call fails as rate limited where the wait is longer than Auto waits for one call. An app your workspace builds for itself has no such limit, as [How your own app differs from Auto's](#how-your-own-app-differs-from-auto-s) says.

What Slack answers each call, the messages a function reads among it, is kept in the playbook's history, for anyone who may read the playbook, as [the configuration reference](../self-host/configuration.md#fields-of-an-entry) says of every tool server. Someone who may read the playbook can then read messages from private channels that Slack would not show them. If you would rather the history keep only the size of each answer, ask your agent to add Slack that way.

## Remove Slack

You can remove Slack in Auto or at Slack.

### In Auto

In Studio, find Slack among your org's connections, press Remove and confirm. Or ask your agent:

```text
Remove my Slack connection from Auto.
```

Auto then ends the connection, and no playbook may use it any more. The app stays in your Slack workspace, @Auto or your own, until someone removes it there, as below.

### At Slack

To remove the app from the whole workspace, in Slack on your desktop:

1. Click your workspace name in the sidebar.
2. Select Tools & settings, then Manage apps.
3. Select Installed apps, find the app and click App details.
4. Open the Configuration tab and choose Remove app.

Where app approval is on, only workspace owners and app managers can remove apps. Slack's help on [removing apps](https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace) has the steps.

Slack then refuses the app's tokens, and the functions that use a connection of it can no longer reach Slack. To use Slack again, add the app again and ask your agent to reconnect the connection. If you no longer want it, remove it in Auto too, as above.

### What remains

Removing Slack does not remove what Slack answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. Auto keeps a line for each notice Slack sends that Auto's app was removed or its tokens revoked, naming the workspace, the Slack members and the time Slack gives.

## Get help

- For help with Slack in Auto, use Auto's [support page](https://on.auto/contact-us).
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).
