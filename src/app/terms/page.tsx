import { LegalPage, H2 } from "@/components/legal/legal-page";
import { legalIdentity } from "@/lib/legal-config";

export const metadata = { title: "Terms of Use" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const legal = legalIdentity();
  return (
    <LegalPage title="Terms of Use" intro="The rules for using Combat Register.">
      <H2>Who we are</H2>
      <p>Combat Register is operated by {legal.entityName}, {legal.entityAddress}. These terms are governed by the law of {legal.jurisdiction}.</p>

      <H2>Your account</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>You must be at least 16 to hold an account.</li>
        <li>Keep your password to yourself. You are responsible for what happens under your account.</li>
        <li>Give us accurate information, particularly when claiming a fighter profile.</li>
        <li>You can delete your account at any time from your account settings.</li>
      </ul>

      <H2>Claiming a fighter profile</H2>
      <p>
        You may claim a profile only if it is yours, or you are authorised to act for that person.
        Submitting someone else&apos;s identity document, or a forged one, will get the claim
        rejected and your account suspended, and may be a criminal offence.
      </p>

      <H2>What you post</H2>
      <p>
        You keep ownership of what you post. You give us a licence to display it on the platform.
        Do not post anything you do not have the right to post — see the{" "}
        <a href="/community-guidelines" className="text-blood-400 hover:text-blood-300">community guidelines</a>.
      </p>

      <H2>What we provide, and what we do not</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Combat Register is an information and community platform. It is provided as-is.</li>
        <li>Fighter records and event data are compiled from public sources and may be wrong or out of date. Do not rely on them for anything that matters.</li>
        <li>
          <b>We do not facilitate betting or wagering of any kind</b>, we are not a bookmaker or a
          trading venue, and nothing here is betting advice.
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
        We may suspend or close an account that breaks these terms or the community guidelines. You
        may close yours at any time.
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
