---
name: difit-hub
description: >-
  How to run difit when the `difit` command is the difit-hub wrapper, which publishes each review on the user's tailnet
  so they can review from a phone. Use together with the difit and difit-review skills whenever one of them starts,
  reads, or stops a difit server and `difit --help` starts with "Usage: difit ls|stop|uninstall".
---

# difit-hub

On this machine `difit` is the difit-hub wrapper around difit. Each review gets a free port published on the user's tailnet, and a web app lists the running reviews so the user can open them from their phone. 
The difit and difit-review skills still decide when to open a review and how to write comments. This skill covers starting, finding, and stopping servers.

Check that the wrapper is installed with `difit --help`: its first line is `Usage: difit ls|stop|uninstall [options]`.
If it is not, ignore this skill.

## Starting a review

Always start with `--background`. The user reviews from their phone, so no browser should open on this machine.

```bash
difit . --background
```

The command prints one JSON line such as `{"port":4966,"url":"https://host.tailnet.ts.net:4966","pid":123}`.
Give the user the `url`; it opens on any device on their tailnet.
The review also appears in the review list, whose URL the command prints to stderr after `all reviews:`.

Do not pass `--host`. The wrapper binds to 127.0.0.1 and publishes the port itself.
Leave out `--port` too, unless the user asks for one; the wrapper picks the first free port in `DIFIT_HUB_PORTS`.

## Requesting the review

Starting a server does not tell the user anything. When you want them to review, request it:

```bash
difit request --port <port> "<what to look at, in one line>"
```

The user's phone gets a notification, and the review shows as "Review needed" in the review list until they mark it done.
Write the message in the language the user is using. Request again after you change the code in answer to their
comments; the same server picks up the changes.

To see whether the user has finished, check the review's `request.done` in `difit ls --json`: it is a time once they
mark it done, and null until then. Read their comments after that, or when they tell you they are done.

## Reusing a running review

The wrapper starts a new server every time, even for a review that is already running.
Before starting one, list the running reviews:

```bash
difit ls --json
```

Each entry has `port`, `repo` (the Git root), `target` (such as `.` or `HEAD`), `comments` (unresolved threads), and `url`.
If an entry has the same `repo` and `target` as the review you want, use its `port` with `difit comment` instead of starting another server.

## Reading and resolving comments

```bash
difit comment get --port <port>
difit comment resolve <threadId...> --port <port>
```

Resolve a thread once you have addressed it. Resolved threads disappear from the review and from the count in the list.

## Stopping a review

```bash
difit stop --port <port>
```

This prints the review's remaining comments, stops the server, and unpublishes its port. Read the printed comments before you move on. Stop servers with `difit stop`, never with `kill`, so the port is unpublished.

Use `difit stop --all` only when the user asks to stop every review. Run `difit uninstall` only when the user asks to remove difit-hub; it stops every review and removes the review list service.
