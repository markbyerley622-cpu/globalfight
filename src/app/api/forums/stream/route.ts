import { subscribe, type ForumEvent } from "@/lib/forum/realtime";

// Long-lived SSE connection backed by Postgres LISTEN/NOTIFY — needs the Node
// runtime (not edge) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const thread = searchParams.get("thread");
  const category = searchParams.get("category");
  const encoder = new TextEncoder();

  let unsub: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (ping) clearInterval(ping);
    if (unsub) unsub();
    unsub = null;
    ping = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      send("retry: 3000\n\n");
      send("event: ready\ndata: {}\n\n");

      const onEvent = (e: ForumEvent) => {
        // Scope the stream: a thread page only wants its own post events; a
        // category/list page only wants new threads in that category.
        if (thread) {
          if (!("threadSlug" in e) || e.threadSlug !== thread) return;
        } else if (category) {
          if ((e.type !== "thread:new" && e.type !== "thread:delete") || e.categorySlug !== category) return;
        }
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      };

      try {
        unsub = await subscribe(onEvent);
      } catch {
        send('event: error\ndata: {"error":"realtime unavailable"}\n\n');
      }
      ping = setInterval(() => send(": ping\n\n"), 25000);

      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
