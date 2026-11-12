# ttfr-bench

A small runner for **one** task: cold create → first successful command (TTFR) on agent sandbox providers.

Each provider runs on its own default image. Inspired by [StarSling's sandbox benchmarks](https://github.com/starslingdev/hpc-sandbox-benchmarks).

Results: [RESULTS.md](RESULTS.md) and https://aiinfraengineer.pages.dev/benchmarks/ttfr/

## Method

1. Record **t0** on a monotonic clock (`performance.now()`) before the provider's create call.
2. Create with the vendor's default image. **spawn_ms** is t0 → create returning a handle. The handle is not necessarily usable yet.
3. Retry `echo ok` (up to 40 tries, 250 ms apart, 2 s per probe) until it exits 0. **cold_start_ms** is t0 → that first success. That is the headline. **time_to_first_exec_ms** is create return → first success.
4. Run `uname -a` once to prove the guest runs a real command. Only the exit code is checked, the output is not saved. Not added to cold_start.
5. Destroy the sandbox. **teardown_ms** is the destroy wall time. Teardown always runs, even after a failure.
6. Repeat on a fresh sandbox. Default **N = 5**, one at a time. Report **p50 / min / max** over successful replicates. A failed replicate is recorded as a failure, never as a zero.
7. Providers without their env var are skipped. Skips are not numbers.

Caveats:

- The clock starts at the create call from this host, not at account signup.
- Host network RTT is inside every number.
- Default images differ in size per vendor, so this ranks time to a usable sandbox, not machine performance.

## Providers

| id | SDK / API | Env var |
|---|---|---|
| `cloudflare` | bench Worker in `cloudflare/` (`@cloudflare/sandbox`) | `CF_BENCH_URL`, `CF_BENCH_TOKEN` |
| `freestyle` | `freestyle` | `FREESTYLE_API_KEY` |
| `tensorlake` | REST (`api.tensorlake.ai`) | `TENSORLAKE_API_KEY` |
| `boxlite` | `@boxlite-ai/boxlite` (REST runtime) | `BOXLITE_API_KEY` (optional `BOXLITE_REST_URL`) |
| `upstash-box` | `@upstash/box` | `UPSTASH_BOX_API_KEY` |
| `e2b` | `e2b` | `E2B_API_KEY` |
| `daytona` | `@daytona/sdk` | `DAYTONA_API_KEY` |
| `runloop` | `@runloop/api-client` | `RUNLOOP_API_KEY` |
| `boat` | `@boatdev/sdk` | `BOAT_API_KEY` |
| `novita` | `novita-sandbox` | `NOVITA_API_KEY` |
| `celesto` | `@celestoai/sdk` | `CELESTO_API_KEY` |
| `vercel` | `@vercel/sandbox` 3.9.1 | `VERCEL_SANDBOX` (token), `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` |
| `fly-sprites` | `@fly/sprites` | `SPRITES_TOKEN` (from sprites.dev/account, or minted from a Fly API token with `SpritesClient.createToken()`; a raw Fly token is rejected) |
| `local` | bash subprocess, harness self-check only | none |

Tensorlake uses REST because its TypeScript SDK throws `DataCloneError` under Bun after creating the sandbox. Vercel is pinned to 3.9.1 because 4.0.0 does not load on Bun 1.2.19.

## Run

Needs [Bun](https://bun.sh). Put keys in `.env` (gitignored, Bun loads it automatically). Never commit it.

```bash
bun install
bun bench.ts --providers local            # harness self-check, no keys
bun bench.ts --providers freestyle,tensorlake -n 5
bun bench.ts --providers all              # skips providers with no key
```

Output: `results/<providers>-<timestamp>-ET.json` with every replicate, the error text for any failure, and the summary stats.

### Cloudflare

A Cloudflare sandbox can only be driven from a Worker, so `cloudflare/` is a tiny Worker that creates a sandbox, runs the command and destroys it, guarded by a bearer token. Timing still happens on this host, so the number includes the laptop → Worker hop.

```bash
cd cloudflare
bun install
npx wrangler deploy
npx wrangler secret put BENCH_TOKEN
```

Then set `CF_BENCH_URL` (the Worker URL) and `CF_BENCH_TOKEN` in your environment. Needs the Workers Paid plan.

## License

MIT.
