// Resolve the feed identity for a request: the authenticated user id when signed
// in (preferences follow the account across devices), otherwise the anonymous
// browser client id passed by the client.
import { getSessionUserId } from "@/lib/auth";

export async function feedKey(fallbackCid: string): Promise<string> {
  try {
    const uid = await getSessionUserId();
    return uid ?? fallbackCid;
  } catch {
    return fallbackCid;
  }
}
