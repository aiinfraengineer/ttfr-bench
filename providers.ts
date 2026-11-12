// One adapter per provider. Each one only knows how to create a fresh sandbox
// on the vendor's default image, run a shell command, and destroy it.
// All timing lives in bench.ts.

export type RunResult = { exitCode: number | null; stdout: string };

export type Sandbox = {
  id: string;
  image: string;
  run(cmd: string): Promise<RunResult>;
  destroy(): Promise<void>;
};

export type Provider = {
  id: string;
  env: string[];
  requiresPaymentMethod: boolean;
  skipReason?: string; // used instead of "missing KEY" when credentials are absent
  note?: string;
  create(): Promise<Sandbox>;
};

const e2b: Provider = {
  id: "e2b",
  env: ["E2B_API_KEY"],
  requiresPaymentMethod: false,
  async create() {
    const { Sandbox, CommandExitError } = await import("e2b");
    const sbx = await Sandbox.create(); // default "base" template
    return {
      id: sbx.sandboxId,
      image: "e2b default template (base)",
      async run(cmd) {
        try {
          const r = await sbx.commands.run(cmd);
          return { exitCode: r.exitCode, stdout: r.stdout };
        } catch (e) {
          // the SDK throws on a non-zero exit instead of returning it
          if (e instanceof CommandExitError) return { exitCode: e.exitCode, stdout: e.stdout };
          throw e;
        }
      },
      async destroy() {
        await sbx.kill();
      },
    };
  },
};

const daytona: Provider = {
  id: "daytona",
  env: ["DAYTONA_API_KEY"],
  requiresPaymentMethod: false,
  note: "SDK create() waits until the sandbox is started, so spawn_ms covers most of the boot.",
  async create() {
    const { Daytona } = await import("@daytona/sdk");
    const sbx = await new Daytona().create(); // default snapshot
    return {
      id: sbx.id,
      image: `daytona default snapshot (${sbx.snapshot ?? "unnamed"})`,
      async run(cmd) {
        const r = await sbx.process.executeCommand(cmd);
        return { exitCode: r.exitCode, stdout: r.result };
      },
      async destroy() {
        await sbx.delete(60, true); // wait until destroyed, not just accepted
      },
    };
  },
};

const runloop: Provider = {
  id: "runloop",
  env: ["RUNLOOP_API_KEY"],
  requiresPaymentMethod: false,
  note: "Uses the low-level devboxes.create(), which returns before the devbox is running.",
  async create() {
    const { RunloopSDK } = await import("@runloop/api-client");
    const sdk = new RunloopSDK();
    const view = await sdk.api.devboxes.create(); // default blueprint
    const box = sdk.devbox.fromId(view.id);
    return {
      id: view.id,
      image: "runloop default devbox",
      async run(cmd) {
        const r = await box.cmd.exec(cmd);
        return { exitCode: r.exitCode, stdout: await r.stdout() };
      },
      async destroy() {
        await box.shutdown();
      },
    };
  },
};

const freestyle: Provider = {
  id: "freestyle",
  env: ["FREESTYLE_API_KEY"],
  requiresPaymentMethod: false,
  note: "Created with an empty firewall (no network), matching Cloudflare's enableInternet: false.",
  async create() {
    const { Freestyle } = await import("freestyle");
    const { vm, vmId } = await new Freestyle().vms.create({ firewall: { rules: [] } });
    return {
      id: vmId,
      image: "freestyle default VM image",
      async run(cmd) {
        const r = await vm.exec(cmd);
        return { exitCode: r.statusCode ?? null, stdout: r.stdout ?? "" };
      },
      async destroy() {
        await vm.delete();
      },
    };
  },
};

const boat: Provider = {
  id: "boat",
  env: ["BOAT_API_KEY"],
  requiresPaymentMethod: true,
  note: "Free trial requires a card at checkout (docs.boat.dev/free-trial). Card added by the account owner for the trial.",
  async create() {
    const { BoatApi, Configuration, execCommand, stopAndRemove } = await import("@boatdev/sdk");
    const api = new BoatApi(
      new Configuration({ basePath: "https://boat.dev/api/v1", accessToken: process.env.BOAT_API_KEY }),
    );
    const created = await api.create({ ttlSeconds: 900 }); // returns 202 while still provisioning
    const id = created.sandbox.id;
    return {
      id,
      image: "boat default machine (type: default)",
      async run(cmd) {
        const r = (await execCommand(api, id, cmd)) as { exitCode?: number | null; stdout?: string };
        return { exitCode: r.exitCode ?? null, stdout: r.stdout ?? "" };
      },
      async destroy() {
        await stopAndRemove(api, id, { delete: true });
      },
    };
  },
};

// Cloudflare sandboxes can only be driven from inside a Worker, so this talks
// to the small Worker in ./cloudflare over HTTP. One fresh Durable Object name
// (and so one fresh container) per replicate.
const cloudflare: Provider = {
  id: "cloudflare",
  env: ["CF_BENCH_URL", "CF_BENCH_TOKEN"],
  requiresPaymentMethod: true, // Workers Paid plan
  note: "Timed from this host through the bench Worker in ./cloudflare, so it includes one extra laptop-to-Worker hop.",
  async create() {
    const name = `ttfr-${crypto.randomUUID()}`;
    const call = async (path: string, body: object) => {
      const res = await fetch(`${process.env.CF_BENCH_URL}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CF_BENCH_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ name, ...body }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text}`);
      return JSON.parse(text);
    };
    await call("/create", {});
    return {
      id: name,
      image: "cloudflare/debian-trixie (lite)",
      run: (cmd) => call("/exec", { cmd }),
      async destroy() {
        await call("/destroy", {});
      },
    };
  },
};

const novita: Provider = {
  id: "novita",
  env: ["NOVITA_API_KEY"],
  requiresPaymentMethod: false, // $100 promo credits, "No credit card is required" (docs.novita.ai/guides/sandbox-pricing)
  note: "E2B-derived SDK: create() returns once POST /sandboxes responds (no client-side ready polling); commands.run throws CommandExitError on non-zero exit.",
  async create() {
    const { Novita, CommandExitError } = await import("novita-sandbox");
    const sbx = await new Novita().sandbox.create(); // default template "base"; key from NOVITA_API_KEY
    return {
      id: sbx.sandboxId,
      image: "novita default template (base)",
      async run(cmd) {
        try {
          const r = await sbx.commands.run(cmd);
          return { exitCode: r.exitCode, stdout: r.stdout };
        } catch (e) {
          // the SDK throws on a non-zero exit instead of returning it
          if (e instanceof CommandExitError) return { exitCode: e.exitCode, stdout: e.stdout };
          throw e;
        }
      },
      async destroy() {
        await sbx.kill();
      },
    };
  },
};

const upstash: Provider = {
  id: "upstash-box",
  env: ["UPSTASH_BOX_API_KEY"],
  requiresPaymentMethod: false, // free tier, "No credit card required" (upstash.com/blog/getting-started-with-ai-agent-sandboxes-for-free)
  note: "SDK Box.create() waits for ready: if POST /v2/box returns 'creating' it polls GET /v2/box/:id every 2s, so spawn_ms may be quantized to ~2s steps.",
  async create() {
    const { Box } = await import("@upstash/box");
    // No runtime passed, so the server picks its default image.
    const box = await Box.create({ apiKey: process.env.UPSTASH_BOX_API_KEY });
    return {
      id: box.id,
      image: "upstash box default runtime (Debian 12 + Node)",
      async run(cmd) {
        // exec.command runs `sh -c cmd` and returns a Run; a non-zero exit does not throw
        const r = await box.exec.command(cmd);
        return { exitCode: r.exitCode, stdout: r.stdout };
      },
      async destroy() {
        await box.delete();
      },
    };
  },
};

// BoxLite Cloud (hosted). Same @boxlite-ai/boxlite package as the local runtime,
// pointed at the REST endpoint via JsBoxlite.rest(...).
// Docs: https://docs.boxlite.ai/cloud/quickstart, https://docs.boxlite.ai/cloud/images
const boxlite: Provider = {
  id: "boxlite",
  env: ["BOXLITE_API_KEY"],
  requiresPaymentMethod: false, // $100 signup credits, no card needed (card adds another $100)
  note: "BoxLite Cloud on its 'base' image. Cloud create() returns with the box already running; start() is a no-op confirm.",
  async create() {
    const { JsBoxlite, BoxliteRestOptions, ApiKeyCredential } = await import("@boxlite-ai/boxlite");
    const rt = JsBoxlite.rest(
      new BoxliteRestOptions({
        url: process.env.BOXLITE_REST_URL ?? "https://api.boxlite.ai",
        credential: new ApiKeyCredential(process.env.BOXLITE_API_KEY!),
      }),
    );
    let box;
    try {
      box = await rt.create({ image: "base" }, `ttfr-${crypto.randomUUID().slice(0, 12)}`);
      await box.start(); // documented as idempotent on Cloud; kept so the box is confirmed running
    } catch (e) {
      if (box) await rt.remove(box.id, true).catch(() => {});
      rt.close();
      throw e;
    }
    const b = box;
    return {
      id: b.id,
      image: "boxlite cloud 'base' image",
      async run(cmd) {
        // exec takes argv; a non-zero exit does not throw, it comes back from wait()
        const ex = await b.exec("sh", ["-c", cmd]);
        const readStdout = (async () => {
          const s = await ex.stdout();
          let out = "";
          for (let line = await s.next(); line !== null; line = await s.next()) out += line;
          return out;
        })();
        const [r, stdout] = await Promise.all([ex.wait(), readStdout]);
        return { exitCode: r.exitCode ?? null, stdout };
      },
      async destroy() {
        try {
          await rt.remove(b.id, true); // force: destroys box and disk
        } finally {
          rt.close();
        }
      },
    };
  },
};

const celesto: Provider = {
  id: "celesto",
  env: ["CELESTO_API_KEY"],
  requiresPaymentMethod: false, // one-time $5 Micro trial credit, no card (celesto.ai/pricing)
  note: "Hosted Celesto Cloud computer via @celestoai/sdk. Computer.create() is one POST with no client-side polling.",
  async create() {
    const { Computer } = await import("@celestoai/sdk");
    // The API now requires an Idempotency-Key on create and SDK 0.1.6 does not send one.
    // Add a fresh key to that one POST only.
    const withKey = (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (init?.method === "POST" && /\/v1\/computers\/?$/.test(url)) {
        const headers = new Headers(init.headers);
        headers.set("Idempotency-Key", crypto.randomUUID());
        init = { ...init, headers };
      }
      return fetch(input, init);
    };
    const computer = await Computer.create({}, { fetch: withKey as typeof fetch }); // default "scratch" template (minimal Ubuntu)
    return {
      id: computer.id,
      image: `celesto default template (${computer.templateId ?? "scratch"})`,
      async run(cmd) {
        // SDK returns exit_code on non-zero; it only throws on HTTP/transport errors
        const r = await computer.run(cmd);
        return { exitCode: r.exitCode ?? null, stdout: r.stdout ?? "" };
      },
      async destroy() {
        await computer.delete();
      },
    };
  },
};

// REST, not the official SDK: @tensorlakeai/tensorlake (engines: node>=22) drives a
// napi native module through worker_threads, and under Bun Sandbox.create() creates
// the sandbox server-side and then throws "DataCloneError: The object can not be cloned."
// Docs: https://docs.tensorlake.ai/api-reference/v2/sandboxes/create
//       https://docs.tensorlake.ai/api-reference/v2/processes/run
//       https://docs.tensorlake.ai/api-reference/v2/sandboxes/delete
const API = "https://api.tensorlake.ai";

const auth = () => ({ authorization: `Bearer ${process.env.TENSORLAKE_API_KEY}` });

async function ok(res: Response, what: string) {
  if (!res.ok) throw new Error(`tensorlake ${what}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const tensorlake: Provider = {
  id: "tensorlake",
  env: ["TENSORLAKE_API_KEY"],
  requiresPaymentMethod: false, // Free tier is $0 with no card (docs.tensorlake.ai/platform/billing)
  note: "REST API (the TS SDK breaks under Bun). POST /sandboxes waits until running by default, so spawn_ms covers boot. Free tier allows 1 concurrent sandbox.",
  async create() {
    // No image => vendor default (tensorlake/ubuntu-minimal). wait defaults to true.
    const res = await ok(
      await fetch(`${API}/sandboxes`, {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: "{}",
      }),
      "create",
    );
    const info = (await res.json()) as { sandbox_id: string; status: string; ingress_endpoint?: string | null };
    const id = info.sandbox_id;
    // Same derivation as the SDK's sandboxUrlFromIngressEndpoint (management port 9501).
    const ingress = new URL(info.ingress_endpoint ?? "https://sandbox.tensorlake.ai");
    const proxy = `${ingress.protocol}//${id}.${ingress.host}`;
    return {
      id,
      image: "tensorlake default image (tensorlake/ubuntu-minimal)",
      async run(cmd) {
        // Streams SSE frames: started, {line, stream}, then {exit_code | signal}.
        // A non-zero exit is reported in the final frame, not as an HTTP error.
        const r = await ok(
          await fetch(`${proxy}/api/v1/processes/run`, {
            method: "POST",
            headers: { ...auth(), "content-type": "application/json" },
            body: JSON.stringify({ command: "sh", args: ["-c", cmd] }),
          }),
          "run",
        );
        let stdout = "";
        let exitCode: number | null = null;
        for (const frame of (await r.text()).split("\n")) {
          if (!frame.startsWith("data:")) continue;
          const ev = JSON.parse(frame.slice(5));
          if (typeof ev.line === "string" && ev.stream !== "stderr") stdout += ev.line + "\n";
          if ("exit_code" in ev || "signal" in ev) exitCode = ev.exit_code ?? null;
        }
        return { exitCode, stdout };
      },
      async destroy() {
        await ok(await fetch(`${API}/sandboxes/${id}`, { method: "DELETE", headers: auth() }), "delete");
      },
    };
  },
};

const vercel: Provider = {
  id: "vercel",
  env: ["VERCEL_SANDBOX", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"],
  requiresPaymentMethod: false,
  note: "SDK create() is a single POST with no client-side polling. persistent: false, so no snapshot is kept.",
  async create() {
    const { Sandbox } = await import("@vercel/sandbox");
    const sbx = await Sandbox.create({
      token: process.env.VERCEL_SANDBOX!,
      teamId: process.env.VERCEL_TEAM_ID!,
      projectId: process.env.VERCEL_PROJECT_ID!,
      persistent: false,
    }); // default image vercel/sandbox/universal
    return {
      id: sbx.name,
      image: "vercel/sandbox/universal (default)",
      async run(cmd) {
        const r = await sbx.runCommand("sh", ["-c", cmd]);
        return { exitCode: r.exitCode, stdout: await r.stdout() };
      },
      async destroy() {
        await sbx.delete({ deleteOrphanSnapshots: true });
      },
    };
  },
};

const sprites: Provider = {
  id: "fly-sprites",
  env: ["SPRITES_TOKEN"],
  requiresPaymentMethod: false,
  note: "Fly.io Sprites via @fly/sprites. The token was minted from a Fly API token with SpritesClient.createToken().",
  async create() {
    const { SpritesClient } = await import("@fly/sprites");
    const client = new SpritesClient(process.env.SPRITES_TOKEN!);
    const name = `ttfr-${Date.now().toString(36)}`;
    const sprite = await client.createSprite(name);
    return {
      id: name,
      image: "sprites default image",
      async run(cmd) {
        try {
          const r = await sprite.execFile("sh", ["-c", cmd]);
          return { exitCode: r.exitCode, stdout: String(r.stdout) };
        } catch (e: any) {
          // like child_process, a non-zero exit is thrown with the code attached
          if (typeof e?.exitCode === "number") return { exitCode: e.exitCode, stdout: String(e.stdout ?? "") };
          throw e;
        }
      },
      async destroy() {
        await client.deleteSprite(name);
      },
    };
  },
};

// Harness check only: a local shell, not a sandbox. Never compare it to the others.
const local: Provider = {
  id: "local",
  env: [],
  requiresPaymentMethod: false,
  note: "Harness self-check on this machine. Not a provider and not part of any comparison.",
  async create() {
    return {
      id: `local-${process.pid}`,
      image: "host shell",
      async run(cmd) {
        const p = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe" });
        const stdout = await new Response(p.stdout).text();
        return { exitCode: await p.exited, stdout };
      },
      async destroy() {},
    };
  },
};

export const PROVIDERS: Provider[] = [
  e2b, daytona, runloop, freestyle, cloudflare, boat, novita, upstash, boxlite, celesto, tensorlake, vercel, sprites,
];
export const HARNESS_CHECK = local;
