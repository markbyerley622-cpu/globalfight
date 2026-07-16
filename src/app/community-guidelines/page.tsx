import { LegalPage, H2 } from "@/components/legal/legal-page";

export const metadata = { title: "Community Guidelines" };
export const dynamic = "force-dynamic";

export default function GuidelinesPage() {
  return (
    <LegalPage title="Community Guidelines" intro="What is and is not allowed, and what happens when the line is crossed.">
      <H2>Prohibited content</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Harassment, threats, or targeting someone because of who they are.</li>
        <li>Hate speech, or slurs of any kind.</li>
        <li>Doxxing — posting someone&apos;s address, phone number, ID, or other private information.</li>
        <li>Sexual content, and anything involving minors.</li>
        <li>Content you do not have the right to post — photographs, video, or text belonging to someone else.</li>
        <li>Impersonating a fighter, official, promoter, or anyone else.</li>
        <li>Spam, scams, and match-fixing or betting solicitation.</li>
        <li>Anything illegal.</li>
      </ul>

      <H2>Reporting</H2>
      <p>
        Every thread and post has a report action. Reports go to a moderator queue and are reviewed
        by a person. If the content is about copyright rather than conduct, use the{" "}
        <a href="/copyright" className="text-blood-400 hover:text-blood-300">copyright notice form</a> —
        it is a legal process and needs different information.
      </p>

      <H2>What we do about it</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Content that breaks these rules is removed.</li>
        <li>Accounts that repeat it are suspended.</li>
        <li>Serious cases (threats, content involving minors) are actioned immediately and may be reported to the police.</li>
        <li>Every moderation decision is logged, so we can review it and so you can appeal it.</li>
      </ul>

      <H2>Appeals</H2>
      <p>
        If we removed something of yours and you think we were wrong, reply to the notification and
        a different moderator will look at it. We keep enough record of the decision to review it
        properly — and no more personal data than that requires.
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
