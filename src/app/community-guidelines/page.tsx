import { LegalPage, H2 } from "@/components/legal/legal-page";

export const metadata = { title: "Community Guidelines" };
export const dynamic = "force-dynamic";

/**
 * These guidelines are written to MATCH THE CODE, not to aspire past it.
 *
 * Two claims were removed rather than reworded, because neither was true:
 *   • "Accounts that repeat it are suspended" — there is no suspension
 *     mechanism. The User model has no suspension field and nothing can set
 *     one, so this described an enforcement power the platform did not have.
 *   • "Reply to the notification and a different moderator will look at it" —
 *     moderator actions do not send notifications, so there was nothing to
 *     reply to. The appeal route is now the one that actually exists.
 *
 * Two things were ADDED because they now happen and a member is entitled to
 * know: automated screening at submission, and the explicit permission to
 * swear. See src/lib/moderation/text.
 */
export default function GuidelinesPage() {
  const contact = process.env.LEGAL_CONTACT_EMAIL || process.env.PRIVACY_CONTACT_EMAIL || null;

  return (
    <LegalPage title="Community Guidelines" intro="What is and is not allowed, and what happens when the line is crossed.">
      {/* Leading with what IS allowed is deliberate. The audience for a fight
          board arrives expecting to be told off for language, and a rules page
          that opens with prohibitions teaches them to post less. */}
      <H2>Swearing is fine</H2>
      <p>
        This is a combat sports community and it talks like one. Profanity, trash talk and blunt
        opinions about fighters, referees and judges are all welcome — &ldquo;that was a robbery&rdquo;,
        &ldquo;he&apos;s getting knocked the f*** out&rdquo; and &ldquo;worst card of the year&rdquo; are
        normal here and nothing screens for them.
      </p>
      <p>
        Violent language <i>about a fight</i> is the subject matter, not a violation. &ldquo;Kill
        him&rdquo;, &ldquo;finish him&rdquo; and &ldquo;he should get slept&rdquo; are fight talk.
        What is not allowed is aiming that at a real person outside the cage.
      </p>

      <H2>Prohibited content</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Slurs — racial, ethnic, homophobic, transphobic, or targeting disability. There is no context in which these are needed to make a point about a fight.</li>
        <li>Hate speech, or content targeting a group of people because of who they are.</li>
        <li>Harassment, or real-world threats against another member.</li>
        <li>Telling someone to harm or kill themselves.</li>
        <li>Doxxing — posting someone&apos;s address, phone number, ID, or other private information.</li>
        <li>Sexual content, and anything involving minors.</li>
        <li>Content you do not have the right to post — photographs, video, or text belonging to someone else.</li>
        <li>Impersonating a fighter, official, promoter, or anyone else.</li>
        <li>Spam, scams, and match-fixing or betting solicitation.</li>
        <li>Anything illegal.</li>
      </ul>

      <H2>Automatic checks</H2>
      <p>
        Posts are checked against a fixed set of rules the moment you submit them. If a post is
        refused you will see a message saying why, and your text stays in the box so you can edit
        it. Nothing is recorded when a post is refused, it is not held against your account, and no
        human sees it — it is a rule check on the words, not a judgement about you.
      </p>
      <p>
        The checks look for slurs, incitement against a group, telling someone to harm themselves,
        and spam. They deliberately do not look for swearing. If an ordinary fight take is ever
        refused, that is a bug and we want to hear about it.
      </p>

      <H2>Reporting</H2>
      <p>
        Every thread and post has a report action. Reports go to a moderator queue and are reviewed
        by a person. If the content is about copyright rather than conduct, use the{" "}
        <a href="/copyright" className="text-blood-400 hover:text-blood-300">copyright notice form</a> —
        it is a legal process and needs different information.
      </p>

      <H2>Blocking</H2>
      <p>
        Reporting asks us to act. Blocking does not wait for us: it is yours, it takes effect
        immediately, and you do not have to justify it to anyone. Every profile has a block action.
      </p>
      <p>
        Blocking someone stops either of you messaging or following the other, removes any
        conversation between you from both inboxes, and hides their posts from you. It is not
        announced — the person you block is not told, and it appears in no public count. You can undo
        it in <a href="/settings" className="text-blood-400 hover:text-blood-300">Settings</a>,
        which is the only place a block can be reversed once their profile has left your feeds.
        Unblocking does not restore a follow that existed before.
      </p>
      <p>
        Blocking is not a substitute for reporting. If someone broke these rules, report them too —
        a block protects you, a report protects everyone else.
      </p>

      <H2>What we do about it</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Content that breaks these rules is hidden from the community.</li>
        <li>
          Hidden content is not destroyed. It stops being shown, and the record is kept so the
          decision can be reviewed — including if you disagree with it.
        </li>
        <li>Serious cases (threats, content involving minors) are actioned immediately and may be reported to the police.</li>
        <li>Every moderation decision is logged against the moderator who made it, including a decision to take no action.</li>
      </ul>

      <H2>Appeals</H2>
      <p>
        If we hid something of yours and you think we were wrong,{" "}
        {contact ? (
          <a href={`mailto:${contact}`} className="text-blood-400 hover:text-blood-300">email us</a>
        ) : (
          <span>contact us through the details in the Privacy Notice</span>
        )}{" "}
        with a link to the post. A moderator who did not make the original decision will look at it.
        We keep enough record of every decision to review it properly — and no more personal data
        than that requires.
      </p>

      <H2>Media uploads</H2>
      <p>
        Uploading clips and images is <b>currently switched off</b>. We are not willing to publish
        files we cannot scan for malware and cannot review before they go public. Text posting is
        unaffected.
      </p>
    </LegalPage>
  );
}
