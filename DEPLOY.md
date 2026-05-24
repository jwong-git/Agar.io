# Deploying to Fly.io

The repo is set up to deploy as a single container on Fly.io: one process
serves both the built client and the `/ws` WebSocket on the port Fly.io provides.

## Prereqs (one-time)

1. **Install flyctl** (the Fly.io CLI). Windows / PowerShell:
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
   Reopen your terminal so PATH picks up `flyctl` / `fly`.
2. **Sign up & log in.**
   ```powershell
   fly auth signup     # or `fly auth login` if you already have an account
   ```

## First deploy

From the project folder:

```powershell
cd C:\Users\user\Documents\Projects\Agar.io
fly launch --no-deploy
```

What it asks you and what to answer:

| Prompt | Answer |
|---|---|
| App name | Anything globally unique (e.g. `agar-jwong`) |
| Region | The one closest to your players (e.g. `lhr` London, `hkg` Hong Kong, `sin` Singapore) |
| Postgres / Redis / Upstash | **No** |
| Deploy now? | We passed `--no-deploy` so it'll skip — that's fine |

This generates a `fly.toml` in the repo. Open it and confirm these lines exist
(adjust if needed):

```toml
[http_service]
  internal_port = 8080
  force_https = true            # tunnel terminates TLS; client uses wss://
  auto_stop_machines = "stop"   # save money when no one's on
  auto_start_machines = true
  min_machines_running = 0      # set to 1 for always-on (no cold start)

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

Then deploy:

```powershell
fly deploy
```

Fly will build the image from the `Dockerfile`, push it, and start a machine.
When it finishes you'll see a `https://<your-app>.fly.dev` URL — that's the
public game link to share.

## Updating

Make changes locally, commit if you like, then:

```powershell
fly deploy
```

## Useful commands

| Command | What it does |
|---|---|
| `fly status` | Machine state, region, last release |
| `fly logs` | Live server logs (great for debugging) |
| `fly open` | Opens your app URL in a browser |
| `fly machine list` | List running machines |
| `fly scale memory 512` | Bump RAM if needed |
| `fly secrets set FOO=bar` | Set an env var (none needed for this app yet) |

## Cold-start vs always-on

The default config above lets the machine **sleep when idle** and wake on
the next request — saves cost but the first player after idle waits a few
seconds. For an always-on box set:

```toml
auto_stop_machines = "off"
min_machines_running = 1
```

## Cost expectation

- Fly's free allowance covers a small always-on `shared-cpu-1x / 256mb` machine.
- Beyond the free allowance, expect roughly **$2–4/month** for a single small
  always-on machine. WebSockets are not charged per-message; bandwidth is
  metered but the free allowance is generous for a hobby game.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `fly deploy` fails on build | Run `npm run build` locally first; fix any error shown |
| App URL loads but ws disconnects immediately | Region is far from you / your players. `fly regions list` then `fly regions set <code>` |
| Cold-start lag on first connect | Set `min_machines_running = 1` (above) |
| 502 / 503 from Fly | Machine crashed — check `fly logs` |

## What this repo does for Fly.io
- `Dockerfile` — builds the client (`npm run build`) and runs the server (`npm start`).
- `.dockerignore` — excludes `node_modules`, `dist`, etc. from the build context.
- `server/index.ts` reads `process.env.PORT` so Fly.io can choose the port.
- Single-origin server (static client + `/ws`) means one port, one TLS termination,
  one URL to share.
