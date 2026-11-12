// TTFR Task 1: cold create -> first successful command.
//
//   bun bench.ts --providers e2b,daytona -n 5
//   bun bench.ts --providers all
//   bun bench.ts --providers local      (harness self-check, no keys needed)

import { platform, release } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { HARNESS_CHECK, PROVIDERS, type Provider, type Sandbox } from "./providers";

const FIRST_COMMAND = "echo ok";
const VERIFY_COMMAND = "uname -a";
const PROBE_ATTEMPTS = 40;
const PROBE_GAP_MS = 250;
const PROBE_TIMEOUT_MS = 2_000;
const CREATE_TIMEOUT_MS = 180_000;
const TEARDOWN_TIMEOUT_MS = 120_000;

const now = () => performance.now(); // monotonic
const round = (ms: number) => Math.round(ms * 10) / 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: Timer;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

type Replicate = {
  index: number;
  ok: boolean;
  image: string | null;
  spawn_ms: number | null;
  cold_start_ms: number | null;
  time_to_first_exec_ms: number | null;
  verify_ms: number | null;
  teardown_ms: number | null;
  first_command_stdout: string | null;
  readiness_attempts: number;
  error: string | null;
  teardown_error: string | null;
};

async function measureOne(p: Provider, index: number): Promise<Replicate> {
  const r: Replicate = {
    index, ok: false, image: null, spawn_ms: null, cold_start_ms: null,
    time_to_first_exec_ms: null, verify_ms: null, teardown_ms: null, first_command_stdout: null,
    readiness_attempts: 0, error: null, teardown_error: null,
  };
  let sbx: Sandbox | undefined;
  const t0 = now();
  try {
    sbx = await withTimeout(p.create(), CREATE_TIMEOUT_MS, "create");
    const tCreated = now();
    r.spawn_ms = round(tCreated - t0);
    r.image = sbx.image;

    // Retry the first command until it exits 0. That instant is the headline number.
    let lastErr = "";
    for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
      r.readiness_attempts = attempt;
      try {
        const res = await withTimeout(sbx.run(FIRST_COMMAND), PROBE_TIMEOUT_MS, "probe");
        if (res.exitCode === 0) {
          const tReady = now();
          r.cold_start_ms = round(tReady - t0);
          r.time_to_first_exec_ms = round(tReady - tCreated);
          r.first_command_stdout = res.stdout.trim();
          break;
        }
        lastErr = `exit code ${res.exitCode}, stdout: ${res.stdout.trim()}`;
      } catch (e) {
        lastErr = errText(e);
      }
      if (attempt < PROBE_ATTEMPTS) await sleep(PROBE_GAP_MS);
    }
    if (r.cold_start_ms === null) throw new Error(`never ready after ${PROBE_ATTEMPTS} probes; last: ${lastErr}`);

    // Second check. Not part of cold_start_ms.
    const tv = now();
    const v = await withTimeout(sbx.run(VERIFY_COMMAND), 30_000, "verify");
    r.verify_ms = round(now() - tv);
    if (v.exitCode !== 0) throw new Error(`verify exit code ${v.exitCode}`);
    r.ok = true;
  } catch (e) {
    r.error = errText(e);
  } finally {
    if (sbx) {
      const td = now();
      try {
        await withTimeout(sbx.destroy(), TEARDOWN_TIMEOUT_MS, "teardown");
        r.teardown_ms = round(now() - td);
      } catch (e) {
        // the sandbox id goes to the console only, never into the published results
        console.log(`${p.id} #${index}: sandbox ${sbx.id} may still be running`);
        r.teardown_error = `${errText(e)} (sandbox may still be running, check the dashboard)`;
      }
    } else if (r.error?.includes("create timed out")) {
      r.teardown_error = "create timed out before returning a handle; a sandbox may have leaked, check the dashboard";
    }
  }
  return r;
}

type Stat = { n: number; min: number; p50: number; max: number } | null;

function stat(values: (number | null)[]): Stat {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  const p50 = xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return { n: xs.length, min: xs[0]!, p50: round(p50), max: xs.at(-1)! };
}

async function measureProvider(p: Provider, n: number) {
  const base = { id: p.id, env_vars: p.env, requires_payment_method: p.requiresPaymentMethod, note: p.note ?? null };
  const missing = p.env.filter((k) => !process.env[k]);
  if (missing.length) {
    const reason = p.skipReason ?? `missing ${missing.join(", ")}`;
    console.log(`${p.id}: skipped (${reason})`);
    return { ...base, status: "skipped", reason, replicates: [], summary: null };
  }

  const replicates: Replicate[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await measureOne(p, i);
    replicates.push(r);
    console.log(
      r.ok
        ? `${p.id} #${i}: cold_start ${r.cold_start_ms} ms (spawn ${r.spawn_ms}, gap ${r.time_to_first_exec_ms}, teardown ${r.teardown_ms ?? "?"})`
        : `${p.id} #${i}: FAILED ${r.error}`,
    );
    if (r.teardown_error) console.log(`${p.id} #${i}: teardown problem: ${r.teardown_error}`);
  }
  const good = replicates.filter((r) => r.ok);
  const summary = {
    n_ok: good.length,
    n_fail: replicates.length - good.length,
    cold_start_ms: stat(good.map((r) => r.cold_start_ms)),
    spawn_ms: stat(good.map((r) => r.spawn_ms)),
    time_to_first_exec_ms: stat(good.map((r) => r.time_to_first_exec_ms)),
    teardown_ms: stat(good.map((r) => r.teardown_ms)),
  };
  return { ...base, status: good.length ? "measured" : "failed", reason: null, replicates, summary };
}

function toCsv(providers: Awaited<ReturnType<typeof measureProvider>>[]) {
  const cols = [
    "provider", "status", "replicate", "ok", "spawn_ms", "cold_start_ms", "time_to_first_exec_ms",
    "teardown_ms", "error", "cold_start_p50_ms", "cold_start_min_ms", "cold_start_max_ms",
  ];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = [cols.join(",")];
  for (const p of providers) {
    const cs = p.summary?.cold_start_ms;
    const tail = [cs?.p50, cs?.min, cs?.max];
    if (!p.replicates.length) rows.push([p.id, p.status, "", "", "", "", "", "", p.reason, ...tail].map(cell).join(","));
    for (const r of p.replicates) {
      rows.push(
        [p.id, p.status, r.index, r.ok, r.spawn_ms, r.cold_start_ms, r.time_to_first_exec_ms, r.teardown_ms, r.error, ...tail]
          .map(cell).join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}

function stamp(d: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const wanted = arg("--providers", "all");
  const n = Number(arg("-n", "5"));
  const outDir = arg("--out", "results");
  const all = [...PROVIDERS, HARNESS_CHECK];
  const selected = wanted === "all" ? PROVIDERS : wanted.split(",").map((id) => {
    const p = all.find((x) => x.id === id.trim());
    if (!p) throw new Error(`unknown provider "${id}". Known: ${all.map((x) => x.id).join(", ")}`);
    return p;
  });
  if (!Number.isInteger(n) || n < 1) throw new Error("-n must be a positive integer");

  const timeZone = "America/New_York"; // fixed so results never reveal the host location
  const started = new Date();
  const providers = [];
  for (const p of selected) providers.push(await measureProvider(p, n));
  const finished = new Date();

  const result = {
    schema_version: 1,
    task: "cold_create_to_first_command",
    method: {
      first_command: FIRST_COMMAND,
      verify_command: VERIFY_COMMAND,
      replicates_requested: n,
      readiness: { attempts: PROBE_ATTEMPTS, gap_ms: PROBE_GAP_MS, probe_timeout_ms: PROBE_TIMEOUT_MS },
      definitions: {
        spawn_ms: "t0 (monotonic, before create) until the provider's create call returns a handle",
        cold_start_ms: "headline TTFR: t0 until the first `echo ok` exits 0",
        time_to_first_exec_ms: "create returned until the first `echo ok` exits 0",
        teardown_ms: "wall time of the provider's destroy call",
      },
    },
    host: {
      platform: `${platform()} ${release()}`,
      runtime: `bun ${Bun.version}`,
      timezone: timeZone,
      note: "Numbers include network round trips from this host.",
    },
    started_at_utc: started.toISOString(),
    finished_at_utc: finished.toISOString(),
    providers,
  };

  mkdirSync(outDir, { recursive: true });
  const base = `${outDir}/${selected.map((p) => p.id).join("-")}-${stamp(started, timeZone)}-ET`;
  writeFileSync(`${base}.json`, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(`${base}.csv`, toCsv(providers));
  console.log(`\nwrote ${base}.json and ${base}.csv`);
}

await main();
