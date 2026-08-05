import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin/guard";
import { getReportQueue, getModerationHistory } from "@/lib/moderation/reports";
import { ReportsConsole } from "@/components/admin/reports-console";

export const metadata: Metadata = {
  title: "Reports",
  robots: { index: false, follow: false },
};

/**
 * The moderator console.
 *
 * `requireAdminPage` 404s for anyone who is not staff — not 403, because a 403
 * confirms the route exists to someone who should not know that.
 *
 * The first page of the queue is server-rendered so a moderator opening this
 * sees work immediately rather than a spinner; the console then refetches
 * client-side as filters change and after each action.
 */
export default async function AdminReportsPage() {
  await requireAdminPage();
  const [reports, history] = await Promise.all([
    getReportQueue({ status: "OPEN" }),
    getModerationHistory(),
  ]);

  return <ReportsConsole initialReports={reports} initialHistory={history} />;
}

export const dynamic = "force-dynamic";
