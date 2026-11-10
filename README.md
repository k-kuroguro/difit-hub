# difit-hub

[difit](https://github.com/yoshiko-pg/difit) wrapper that runs difit and publishes each review on the tailnet.

## Use

```sh
difit .                        # review uncommitted changes; HEAD, staged, a range, or --pr also work
difit . --background           # return right away and print {"port":…,"url":…}
difit ls                       # list running reviews (--json for scripts)
difit request --port 4966 "…"  # ask the user to review it, with a notification
difit wait --port 4966         # wait until the user marks it done, then print the comments
difit comment get --port 4966  # run difit's own subcommands as usual
difit stop --port 4966         # print the review's remaining comments, then stop it
difit stop --all               # do the same for every review
difit uninstall                # stop every review and remove the service
```

Open `https://<machine>.<tailnet>.ts.net:4965/` on the phone and add it to the home screen.

To use other ports, set `DIFIT_HUB_PORTS=5966-5979` and `DIFIT_HUB_WEB_PORT=5965`.

## Install

With [mise](https://mise.jdx.dev):

```toml
[tools]
"github:k-kuroguro/difit-hub" = "1.1.0"
```

For coding agents, install the `difit-hub` skill next to difit's own skills with [apm](https://github.com/microsoft/apm):

```yaml
dependencies:
  apm:
    - yoshiko-pg/difit/skills/difit#v5.0.12
    - yoshiko-pg/difit/skills/difit-review#v5.0.12
    - k-kuroguro/difit-hub/skills/difit-hub#v1.1.0
```
