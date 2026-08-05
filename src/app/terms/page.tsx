import { LegalPage, H2 } from "@/components/legal/legal-page";
import { legalIdentity } from "@/lib/legal-config";

export const metadata = { title: "Terms of Use" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const legal = legalIdentity();
  return (
    <LegalPage title="Terms of Use" intro="The rules for using Combat Reviews.">
      <H2>Who we are</H2>
      <p>Combat Reviews is operated by {legal.entityName}, {legal.entityAddress}. These terms are governed by the law of {legal.jurisdiction}.</p>

      <H2>Your account</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>You must be at least 16 to hold an account.</li>
        <li>Keep your password to yourself. You are responsible for what happens under your account.</li>
        <li>Give us accurate information, particularly when claiming a fighter profile.</li>
        <li>You can delete your account at any time from <a href="/profile/settings" className="text-blood-400 hover:text-blood-300">Settings</a>.</li>
      </ul>

      <H2>Claiming a fighter profile</H2>
      <p>
        You may claim a profile only if it is yours, or you are authorised to act for that person.
        Submitting someone else&apos;s identity document, or a forged one, will get the claim
        rejected and your account closed, and may be a criminal offence.
      </p>

      <H2>What you post</H2>
      <p>
        You keep ownership of what you post. You give us a non-exclusive licence to host and display
        it on the platform. Do not post anything you do not have the right to post — see the{" "}
        <a href="/community-guidelines" className="text-blood-400 hover:text-blood-300">community guidelines</a>.
      </p>
      <p>
        <b>Posting here is public.</b> Your profile, your predictions, your accuracy and leaderboard
        position, who you follow and who follows you, and everything you post in a public thread can
        be read by anyone, including people who are not signed in and search engines.
      </p>
      <p>
        <b>What happens to your posts if you delete your account.</b> Your account and personal data
        are deleted. Discussion you have already published stays on the thread it belongs to, with
        your name, handle and photo removed and replaced by &ldquo;Deleted User&rdquo; — because
        deleting a thread would also delete the replies other people wrote underneath it. The licence
        above continues for that anonymised content only. If you want a specific post removed, delete
        the post before you delete the account.
      </p>

      <H2>Moderation of what you post</H2>
      <p>
        Posts are automatically checked against a fixed set of rules when you submit them, and a post
        that breaks those rules is refused and never published. Swearing is not screened. A refused
        post is not stored and has no consequence for your account. Content that is reported by other
        members is reviewed by a moderator, who may hide it. See the{" "}
        <a href="/community-guidelines" className="text-blood-400 hover:text-blood-300">community guidelines</a>{" "}
        for what is prohibited and how to appeal.
      </p>

      <H2>What we provide, and what we do not</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Combat Reviews is an information and community platform. It is provided as-is.</li>
        <li>Fighter records and event data are compiled from public sources and may be wrong or out of date. Do not rely on them for anything that matters.</li>
        <li>
          <b>We do not facilitate betting or wagering of any kind</b>, we are not a bookmaker or a
          trading venue, and nothing here is betting advice. Predictions are free to make, no money
          or anything of value is ever staked, and the points and reputation you earn have no
          monetary value, cannot be exchanged, transferred or cashed out, and can be reset or
          withdrawn at any time.
        </li>
        <li>We may change, suspend or withdraw any part of the service.</li>
      </ul>

      <H2>Copyright</H2>
      <p>
        If you believe content here infringes your copyright, tell us using the{" "}
        <a href="/copyright" className="text-blood-400 hover:text-blood-300">copyright notice form</a>.
      </p>

      <H2>Ending your access</H2>
      <p>
        We may hide content, or close an account, that breaks these terms or the community
        guidelines. You may close yours at any time from{" "}
        <a href="/profile/settings" className="text-blood-400 hover:text-blood-300">Settings</a>;
        deletion is immediate and, apart from the anonymised discussion described above, permanent.
      </p>

      <H2>Liability</H2>
      <p>
        Nothing in these terms limits liability for death or personal injury caused by negligence,
        for fraud, or for anything else that cannot be limited by law. Subject to that, we are not
        liable for indirect or consequential loss, or for loss arising from your reliance on data
        published here.
      </p>
    </LegalPage>
  );
}
