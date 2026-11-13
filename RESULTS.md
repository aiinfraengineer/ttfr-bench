# Task 1 results: cold create to first command

Date: 2026-11-11 to 2026-11-12 (US Eastern)
Host: darwin 27.0.0, bun 1.2.19, one laptop over the public Internet. Every number includes network round trips from that host.
Method: t0 before create until the first `echo ok` exits 0. N=5. Vendor default images. See [README.md](README.md).

This is not signup-to-first-request in a browser.

## Summary

All times in ms, over successful replicates. Skips and failures are not zeros and are not ranked.

| Provider | Card? | Status | cold_start p50 | min | max | n ok / n |
|---|---|---|---|---|---|---|
| Cloudflare Sandbox | Workers Paid plan ($5/mo minimum), existing account | measured | 483.0 | 467.1 | 888.4 | 5 / 5 |
| Fly.io Sprites | No ($1 trial) | measured | 623.2 | 504.5 | 746.1 | 5 / 5 |
| Vercel Sandbox | No (Hobby plan) | measured | 661.9 | 631.9 | 1067.1 | 5 / 5 |
| Freestyle | No (Free plan, no card added) | measured | 975.6 | 896.6 | 1572.1 | 5 / 5 |
| Tensorlake | No | measured | 1918.8 | 1895.1 | 2490.0 | 5 / 5 |
| BoxLite Cloud | No | measured | 4067.3 | 3752.2 | 4428.2 | 5 / 5 |
| Upstash Box | No | measured | 5019.3 | 2756.1 | 11667.4 | 5 / 5 |
| Celesto | No ($5 trial credit) | measured | 6938.5 | 6030.2 | 17304.0 | 5 / 5 |
| E2B | $5 card verification payment | blocked |  |  |  |  |
| Runloop | n/a | blocked (invite only) |  |  |  |  |
| boat.dev | Card checkout for a plan | blocked (402) |  |  |  |  |
| Novita | No balance | blocked (402) |  |  |  |  |

### All metrics, p50 (min to max)

| Provider | spawn_ms | time_to_first_exec_ms | teardown_ms |
|---|---|---|---|
| Cloudflare Sandbox | 310.7 (297.7 to 716.3) | 172.3 (169.4 to 202.5) | 235.0 (198.8 to 261.3) |
| Fly.io Sprites | 433.0 (307.7 to 558.3) | 188.8 (179.4 to 196.8) | 1043.7 (628.6 to 3419.1) |
| Vercel Sandbox | 371.5 (358.6 to 764.0) | 279.2 (269.9 to 327.2) | 333.0 (305.7 to 467.0) |
| Freestyle | 659.6 (590.4 to 1272.0) | 304.0 (296.8 to 316.1) | 379.3 (362.9 to 455.7) |
| Tensorlake | 851.4 (842.3 to 1372.2) | 1063.0 (1052.8 to 1117.8) | 221.6 (218.9 to 226.0) |
| BoxLite Cloud | 2336.8 (2093.9 to 2683.7) | 1737.6 (1462.4 to 1752.1) | 295.2 (283.4 to 560.2) |
| Upstash Box | 4742.8 (2488.1 to 11395.9) | 276.5 (268.0 to 284.2) | 1685.0 (499.9 to 2651.6) |
| Celesto | 1572.7 (1554.6 to 2464.1) | 5139.1 (4475.6 to 14839.9) | 707.3 (695.5 to 833.5) |

`spawn_ms` is when the SDK's create call returned. Where that happens differs by SDK (see notes), so compare `cold_start` across providers, not `spawn_ms`.

## Per provider

Errors are copied exactly as the SDK or API returned them.

### Cloudflare Sandbox

- Official docs used: https://developers.cloudflare.com/sandbox/, https://developers.cloudflare.com/sandbox/get-started/, https://developers.cloudflare.com/containers/api/durable-object-container/, https://developers.cloudflare.com/workers/platform/pricing/
- Card: needs the Workers Paid plan ($5/month minimum). The account was already on it.
- Token: wrangler login plus a `BENCH_TOKEN` secret on the bench Worker
- Image / default size: `cloudflare/debian-trixie`, `lite`, `enableInternet: false`
- Run: `results/cloudflare-20261111-230436-ET.json`, bench Worker deployed 2026-11-11 (US Eastern)
- Errors (verbatim): none, 5 of 5 ok
- Notes: only reachable through a Worker, so timing goes through the bench Worker in `cloudflare/` and includes one extra hop from this machine to the Worker. `start()` returns before the container is ready, and `exec()` waits for a container that is still starting. One unpublished smoke replicate ran about 5 s before this series, so these runs were not the first container start after deploy.

### Vercel Sandbox

- Official docs used: https://vercel.com/docs/vercel-sandbox, https://vercel.com/docs/vercel-sandbox/pricing
- SDK: `@vercel/sandbox` 3.9.1. Version 4.0.0 fails to load on Bun 1.2.19: `SyntaxError: Export named 'Dispatcher1Wrapper' not found in module 'undici'.`
- Card: none, Hobby plan. Auth with an access token plus a dedicated empty Vercel project for the sandboxes.
- Image: default `vercel/sandbox/universal`, created with `persistent: false`, deleted after each replicate
- Run: `results/vercel-20261112-121904-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Notes: `Sandbox.create()` is a single POST with no client-side polling. Commands run through `sh -c`.

### Freestyle

- Official docs used: https://www.freestyle.sh/docs/vms, https://www.freestyle.sh/docs/quickstart, https://www.freestyle.sh/pricing
- Card: none on the Free plan. No card added (adding one charges $1 for verification, then refunds it).
- Image / default size: default VM image, 4 vCPU / 8 GiB / 32 GB per freestyle.sh/pricing.md, created with an empty firewall (no network)
- Run: `results/freestyle-20261112-035301-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Screenshots: `docs/screenshots/freestyle/`

### Tensorlake

- API: `https://api.tensorlake.ai/sandboxes` (REST)
- Image: default `tensorlake/ubuntu-minimal`
- Run: `results/tensorlake-20261112-035623-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Notes: uses the REST API. The TypeScript SDK creates the sandbox and then throws `DataCloneError` under Bun, leaving the sandbox running. `POST /sandboxes` waits until running, so `spawn_ms` covers boot. Exec goes over SSE to `https://<id>.sandbox.tensorlake.ai/api/v1/processes/run`. The free tier allows 1 concurrent sandbox, which is fine because replicates run one at a time.

### BoxLite Cloud

- SDK: `@boxlite-ai/boxlite` 0.13.0, REST runtime
- Image: BoxLite Cloud `base`
- Run: `results/upstash-box-boxlite-20261112-035440-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Notes: cloud `create()` returns with the box already running.

### Upstash Box

- SDK: `@upstash/box` 0.7.10
- Image: default runtime (Debian 12 + Node)
- Run: `results/upstash-box-boxlite-20261112-035440-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Notes: `Box.create()` waits for ready. If `POST /v2/box` returns `creating`, it polls `GET /v2/box/:id` every 2 s, so `spawn_ms` lands in roughly 2 s steps. That explains part of the wide spread.

### E2B

- Official docs used: https://e2b.dev/docs/commands, https://e2b.dev/docs/sandbox, https://e2b.dev/pricing, https://e2b.dev/docs/billing
- Status: blocked. The pricing page says "No credit card required", but the new workspace showed: "This workspace is blocked until it is verified. Make a verification payment to keep using E2B." The payment is $5.00. Not made.
- Screenshots: `docs/screenshots/e2b/`

### Runloop

- Official docs used: https://runloopai.github.io/api-client-ts/stable/, https://runloop.ai/pricing
- Status: blocked. Signup page: "Registration is currently by invitation only. Please email support@runloop.ai to join the waitlist." The docs banner (captured 2026-11-11) says: "Runloop is winding down its services. Support for existing customers continues through November 13, 2026 at 11:59 PM PT."
- Screenshots: `docs/screenshots/runloop/`
- Notes: adapter uses the low-level `devboxes.create()`, which returns before the devbox is running.

### boat.dev

- Official docs used: https://docs.boat.dev/free-trial, https://docs.boat.dev/pricing, https://docs.boat.dev/sdks/typescript
- Status: blocked. The API key authenticates, but create returns: `402 billing_required: Start the $20/month Boat plan to create sandboxes.`
- Screenshots: `docs/screenshots/boat/`
- Notes: create returns `202 provisioning`. A command sent while the sandbox is still starting waits up to 60 s on the server.

### Novita

- SDK: `novita-sandbox` 2.1.3 (E2B-derived)
- Status: blocked. Create returns: `SandboxError: 402: insufficient balance`. Novita's docs say the free credit unlocks after an onboarding survey.

### Celesto

- SDK: `@celestoai/sdk` 0.1.6
- Image / default size: `scratch` template (Ubuntu 24.04), `micro` size, 1 vCPU / 2 GB RAM / 20 GB disk
- Run: `results/celesto-20261112-183812-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Key history: earlier keys returned `403: This API key needs 'Create, start, stop computers and run commands' permission`, then `CelestoApiError: Unauthorized.`, then `403 api_key_scope_required: This API key needs 'Delete computers' permission`. The series ran with a key that has create, run and delete permissions. The one smoke computer left behind by the earlier key was deleted from the dashboard.
- Notes: `Computer.create()` is one POST with no client-side polling, so most of the boot shows up as `time_to_first_exec_ms`. The first replicate needed 16 probes (17.3 s), the other four 7 to 9 (6.0 to 7.3 s).
- Notes: the API now requires an `Idempotency-Key` on create (`CelestoApiError: Idempotency-Key is required for computer creation`) and SDK 0.1.6 does not send one, so the adapter adds it through a custom `fetch`.

### Fly.io Sprites

- Official docs used: https://docs.sprites.dev/cli/authentication/, https://fly.io/sprites
- SDK: `@fly/sprites` 0.2.4
- Card: none needed for the $1 trial per fly.io/sprites.
- Token: a regular Fly.io API token returns `401 authentication failed` from `api.sprites.dev`. The Sprites token was minted from it with `SpritesClient.createToken()` (`POST /v1/organizations/{org}/tokens`).
- Image: Sprites default
- Run: `results/fly-sprites-20261112-164255-ET.json`
- Errors (verbatim): none, 5 of 5 ok
- Notes: a new sprite name per replicate, deleted with `DELETE /v1/sprites/{name}`. No sprites were left afterwards. Teardown is slow and uneven (0.6 to 3.4 s), but it is not part of cold_start. Sprites and Vercel are 39 ms apart at p50, which is too close to rank with N=5.

## What this does not claim

- Not a ranking of pipeline or disk performance.
- Each vendor's default machine size differs.
- One client location and N=5. It ranks wide gaps, not close ones.
- Skips and failures are not zeros.

Published at https://infraengineer.dev/benchmarks/ttfr/ with the raw JSON.
