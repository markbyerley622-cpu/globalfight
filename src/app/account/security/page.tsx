import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const dynamic = "force-dynamic";

/**
 * Account security. Server-rendered so the signed-in check happens before any
 * markup is sent — and so we can tell a credential account from an OAuth-only one
 * without exposing that fact to an unauthenticated caller.
 */
export default async function AccountSecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/account");

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  const hasPassword = Boolean(row?.passwordHash);

  return (
    <>
      <PageHero
        eyebrow="Account"
        title="Security"
        description="Change your password. Your other devices are signed out whenever it changes."
      />
      <div className="container-cr py-10">
        <div className="card-surface mx-auto max-w-md p-6">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="size-5 text-fog" />
            <h2 className="font-display text-base font-bold text-chalk">Password</h2>
          </div>

          {hasPassword ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-sm text-mist">
              This account signs in with a linked provider, so there is no password to change.
            </p>
          )}

          <p className="mt-5 border-t border-ink-800 pt-4 text-xs text-fog">
            Forgotten your password?{" "}
            <Link href="/account/forgot" className="text-blood-400 hover:text-blood-300">
              Reset it by email
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
