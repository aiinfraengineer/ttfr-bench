// Three calls per sandbox: create, exec, destroy. The bench script on the
// laptop times them. Each replicate uses a new name, so a new Durable Object
// and a new container.
import { DurableObject } from "cloudflare:workers";

export class BenchSandbox extends DurableObject<Env> {
  // start() returns before the container is ready. exec() waits for a
  // container that is still starting.
  async create() {
    this.ctx.container!.start({
      image: "cloudflare/debian-trixie",
      entrypoint: ["sleep", "infinity"],
      enableInternet: false,
    });
  }

  async exec(cmd: string) {
    const proc = await this.ctx.container!.exec(["sh", "-c", cmd]);
    const out = await proc.output();
    return { exitCode: out.exitCode, stdout: new TextDecoder().decode(out.stdout) };
  }

  async destroy() {
    await this.ctx.container!.destroy();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("authorization") !== `Bearer ${env.BENCH_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    if (request.method !== "POST") return new Response("POST only", { status: 405 });
    const { name, cmd } = (await request.json()) as { name: string; cmd?: string };
    const sandbox = env.SANDBOX.getByName(name);
    try {
      switch (new URL(request.url).pathname) {
        case "/create":
          await sandbox.create();
          return Response.json({ ok: true });
        case "/exec":
          return Response.json(await sandbox.exec(cmd ?? ""));
        case "/destroy":
          await sandbox.destroy();
          return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
    }
  },
};
