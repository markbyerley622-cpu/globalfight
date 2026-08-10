import Link from "next/link";
import { LegalPage, H2 } from "@/components/legal/legal-page";
import { legalIdentity } from "@/lib/legal-config";
import { DATA_CATEGORIES } from "@/lib/privacy-inventory";

export const metadata = {
  title: "Delete your account",
  description:
    "How to delete your Combat Reviews account and what happens to your data when you do.",
  alternates: { canonical: "/delete-account" },
};
export const dynamic = "force-dynamic";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ACCOUNT DELETION — the PUBLIC page, reachable without signing in.
 *
 *  ── Why this exists separately from the settings screen ─────────────────
 *  The delete API and its UI already existed, behind sign-in at
 *  /profile/settings. Google Play's User Data policy requires something the
 *  in-app path cannot be: a URL that is reachable WITHOUT installing the app or
 *  holding a working session, submitted in the Data Safety form as the account
 *  deletion link. It has to answer the question for two people the settings
 *  screen cannot reach — someone deciding whether to sign up at all, and
 *  someone locked out of the account they want deleted.
 *
 *  ── Why the copy is READ FROM THE INVENTORY ─────────────────────────────
 *  What deletion actually does is already stated, precisely, in
 *  src/lib/privacy-inventory.ts (the same source the privacy notice renders
 *  from). Re-typing it here would create a second description of one behaviour,
 *  and the two would disagree the first time the behaviour changed — on the
 *  page whose entire job is to be accurate about it.
 * ════════════════════════════════════════════════════════════════════════════
 */
export default function DeleteAccountPage() {
  const legal = legalIdentity();
  const account = DATA_CATEGORIES.find((c) => c.category === "Account");
  const content = DATA_CATEGORIES.find((c) => c.category === "Community content");

  return (
    <LegalPage
      title="Delete your account"
      intro="How to delete your Combat Reviews account, what is destroyed, and the one thing that is kept."
    >
      <H2>If you can sign in</H2>
      <p>
        Go to{" "}
        <Link href="/settings" className="text-blood-400 hover:text-blood-300">
          Settings
        </Link>{" "}
        and use <b>Delete account</b> at the bottom of the page. You will be asked for your password —
        deletion is irreversible, so a stolen session alone must not be enough to destroy your
        account. It happens immediately; there is no queue and no waiting period.
      </p>

      <H2>If you cannot sign in</H2>
      <p>
        Email <b>{legal.privacyEmail}</b> from the address on the account and ask for it to be
        deleted. We will verify that the address is yours before doing anything, because a deletion
        request is also the easiest way to attack someone else&apos;s account.
      </p>

      <H2>What is destroyed</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your account, name, email address, username and password.</li>
        <li>
          Any identity document you uploaded when claiming a fighter or gym profile — the file
          itself in storage, not only the database row pointing at it.
        </li>
        <li>Your predictions, follows, favourites, bookmarks, check-ins and notifications.</li>
        <li>Direct messages you sent, and any block list you had.</li>
        <li>Your map pin, if you placed one.</li>
      </ul>

      <H2>The one exception, stated plainly</H2>
      {content && <p>{content.retention}</p>}
      <p>
        In short: discussion you posted stays on the thread it belongs to and is re-attributed to
        &ldquo;Deleted User&rdquo;. Deleting a thread outright would delete the replies other people
        wrote inside it. Your name, handle, photo and every other identifier are severed from it,
        and nothing links it back to you.
      </p>

      {account && (
        <>
          <H2>Retention</H2>
          <p>{account.retention}</p>
        </>
      )}

      <p className="mt-6 text-xs text-fog">
        The full picture of what is held and for how long is in the{" "}
        <Link href="/privacy" className="text-blood-400 hover:text-blood-300">
          Privacy Notice
        </Link>
        .
      </p>
    </LegalPage>
  );
}
