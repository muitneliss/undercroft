---
title: "Undercroft: what the app does and why it reads Google data"
description: "Undercroft is a data platform for organisations. This page explains what it does, what it reads from Gmail and Google Drive, why, and what it never does with that data."
updated: 2026-10-18
---

**Undercroft** is a data platform for organisations, operated by multnelis at [undercroft.lowbit.link](https://undercroft.lowbit.link). It copies the business data an organisation already has, from email, documents and accounting and sales systems, into one place the organisation controls. There its team can search it, model it with SQL and build reports on it.

This page explains the app to anyone who has not signed in. Signing in is needed only to use the app, not to read about it. The [privacy policy](/en/privacy/) and the [terms of service](/en/terms/) are public too.

## What it is for

Most organisations keep their facts in several systems that do not talk to each other: invoices in Xero, deals in HubSpot, contracts and receipts in Google Drive, and orders and confirmations in Gmail. Undercroft brings them together without changing any of them:

1. **Connect a source.** An administrator of the organisation's workspace connects a source, for example a Gmail mailbox or a Google Drive folder, and chooses exactly what Undercroft may read.
2. **Keep the original.** Undercroft reads that data with read-only access and keeps an unchanged copy in the workspace's own data store. The text of emails and documents is extracted so the workspace can search it.
3. **Define the answers.** The workspace's members write their own SQL models on that copy, for example "every supplier invoice received by email this month", and build reports and dashboards from them.

Each organisation is a separate workspace. Its data is visible only to the members its administrator invites, according to the role they give them.

## What it reads from Google, and why

Undercroft uses Google APIs for two things only: signing in, and reading the Gmail and Google Drive data an administrator chooses to connect.

| Google permission                           | What Undercroft does with it                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openid`, `email`, `profile`                | Signs you in with your Google account, and records which Google account gave consent to a connection.                                                                                                |
| `gmail.readonly`, read-only Gmail           | Reads the messages in the labels the administrator picks, and only those: sender, recipients, subject, date, body and attachments of the file types they pick. Never sends, changes or deletes mail. |
| `drive.readonly`, read-only Google Drive    | Reads the files in the folders the administrator picks, and the text inside them. Never creates, changes or deletes files.                                                                           |
| `drive.file`, only for Google's file picker | Shows Google's own picker in the browser so the administrator can choose folders. Returns only the ids of what they chose.                                                                           |

The workspace uses this data to search its own email and documents, and to build models and reports on them: for example matching an emailed invoice to the payment recorded in the accounting system.

## What it never does with Google data

- It never sells Google user data, and never uses it for advertising.
- It never uses Google user data to create, edit or generate images, video, audio or any other synthetic media. That includes intimate imagery of any kind.
- It never uses Google user data to develop, improve or train artificial intelligence or machine learning models, and never lets a provider do so.
- It never writes to a Gmail mailbox or a Google Drive. Every Google permission it asks for to read data is read-only.

Undercroft's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. The [privacy policy](/en/privacy/) sets out how the data is stored, protected, shared and deleted, and names the two optional features that send text to an outside provider.

## Removing access

An administrator can disconnect a Google source at any time. Undercroft then revokes its access token with Google and deletes its stored copy of it. You can also remove Undercroft's access from your [Google Account permissions page](https://myaccount.google.com/permissions). To have the data already read deleted, write to [contact@multnelis.org](mailto:contact@multnelis.org).

## Open source

Undercroft is open-source software under the MIT licence. Anyone can install and run their own copy. A copy someone runs themselves is not operated by multnelis, and this page, the privacy policy and the terms describe only the hosted service at [undercroft.lowbit.link](https://undercroft.lowbit.link).

## Contact

Questions about the app or about how it uses Google data: [contact@multnelis.org](mailto:contact@multnelis.org).
