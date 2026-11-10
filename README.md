# difit-hub

[difit](https://github.com/yoshiko-pg/difit) wrapper that runs difit and publishes each review on the tailnet.

## Use

```sh
difit .                        # review uncommitted changes; HEAD, staged, a range, or --pr also work
difit . --background           # return right away; prints {"port":…,"url":…}
difit ls                       # running reviews (--json for scripts)
difit request --port 4966 "…"  # ask the user to review it: their phone gets a notification
difit comment get --port 4966  # difit's own subcommands work as usual
difit stop --port 4966         # print the review's remaining comments, then stop it
difit stop --all
difit uninstall                # stop everything, remove the service, unpublish the ports
```

Open `https://<machine>.<tailnet>.ts.net:4965/` on the phone and add it to the home screen.

To use other ports, set `DIFIT_HUB_PORTS=5966-5979` and `DIFIT_HUB_WEB_PORT=5965`.

## Install

With [mise](https://mise.jdx.dev):

```toml
[tools]
"github:k-kuroguro/difit-hub" = "1.0.1"
```

For coding agents, install the `difit-hub` skill next to difit's own skills with [apm](https://github.com/microsoft/apm):

```yaml
dependencies:
  apm:
    - yoshiko-pg/difit/skills/difit#v5.0.12
    - yoshiko-pg/difit/skills/difit-review#v5.0.12
    - k-kuroguro/difit-hub/skills/difit-hub#v1.0.1
```
