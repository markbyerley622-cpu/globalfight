import { LegalPage, H2 } from "@/components/legal/legal-page";
import { legalIdentity } from "@/lib/legal-config";
import { CopyrightNoticeForm } from "@/components/legal/copyright-form";

export const metadata = { title: "Copyright & Takedown" };
export const dynamic = "force-dynamic";

export default function CopyrightPage() {
  const legal = legalIdentity();

  return (
    <LegalPage
      title="Copyright & Takedown"
      intro="How to tell us that content on Combat Register infringes your rights."
    >
      <H2>Our position</H2>
      <p>
        We do not publish third-party photography. Fighter images are neutral generated placeholders,
        news items link to the publisher rather than reproducing their imagery, and we do not
        republish ranking tables. If something has slipped through, we want to know.
      </p>

      <H2>Sending a notice</H2>
      <p>
        Use the form below, or email <b>{legal.copyrightEmail}</b>. Please include what the content
        is, where it is, what work of yours it infringes, and confirmation that you own the rights
        and are acting in good faith. We will review it and, if it is well-founded, remove the
        content.
      </p>
      <p className="text-fog">
        Please do not use this form for abuse, spam or harassment — use the report action on the
        content itself, which goes to our moderators.
      </p>

      <H2>Counter-notice</H2>
      <p>
        If we remove something of yours and you believe that was a mistake, reply to the notification
        we send you. We record the counter-notice and review the decision.
      </p>

      <H2>Repeat infringers</H2>
      <p>Accounts that repeatedly post infringing content are suspended.</p>

      <div className="mt-8 rounded-lg border border-ink-800 bg-ink-950/40 p-5">
        <h3 className="mb-4 font-display text-base font-bold text-chalk">Submit a copyright notice</h3>
        <CopyrightNoticeForm />
      </div>
    </LegalPage>
  );
}
