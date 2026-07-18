import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordEvent, isEventName } from "@/lib/analytics";

/** Client event ingest. First-party, cookieless: we attach userId only if the
 *  session is already signed in — we never set a tracking cookie. Unknown event
 *  names are dropped. Always 204 so the client never retries or surfaces errors. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (isEventName(body?.name)) {
      const user = await getCurrentUser();
      await recordEvent({
        name: body.name,
        userId: user?.id ?? null,
        path: typeof body.path === "string" ? body.path.slice(0, 512) : null,
        props: body.props && typeof body.props === "object" ? body.props : null,
      });
    }
  } catch {
    // ignore — analytics never errors to the client
  }
  return new NextResponse(null, { status: 204 });
}

export const dynamic = "force-dynamic";
