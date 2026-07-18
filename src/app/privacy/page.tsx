import { LegalPage, H2 } from "@/components/legal/legal-page";
import { legalIdentity } from "@/lib/legal-config";
import { DATA_CATEGORIES, PROCESSORS, COOKIES } from "@/lib/privacy-inventory";

export const metadata = { title: "Privacy Notice" };
export const dynamic = "force-dynamic";

/**
 * The privacy notice is RENDERED FROM THE CODE-LEVEL DATA INVENTORY
 * (src/lib/privacy-inventory.ts), not from a template. If a processor is removed from
 * the code, delete its row and this page stops claiming it. If one is added and the
 * inventory is not updated, that is a bug — and it is exactly the kind of bug that
 * makes a privacy notice untrue.
 */
export default function PrivacyPage() {
  const legal = legalIdentity();

  return (
    <LegalPage
      title="Privacy Notice"
      intro="What we collect, why, who we send it to, and how long we keep it. Written from what the code actually does."
    >
      <p>
        This notice explains how {legal.entityName} handles your personal data when you use
        Combat Register. We are the data controller. If you have a question or want to exercise
        any of your rights, contact <b>{legal.privacyEmail}</b>.
      </p>

      <H2>What we collect and why</H2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink-700 text-left text-fog">
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">What</th>
              <th className="py-2 pr-4">Why</th>
              <th className="py-2 pr-4">Lawful basis</th>
              <th className="py-2">How long</th>
            </tr>
          </thead>
          <tbody>
            {DATA_CATEGORIES.map((c) => (
              <tr key={c.category} className="border-b border-ink-800 align-top">
                <td className="py-3 pr-4 font-semibold text-chalk">{c.category}</td>
                <td className="py-3 pr-4">{c.data}</td>
                <td className="py-3 pr-4">{c.purpose}</td>
                <td className="py-3 pr-4">{c.lawfulBasis}</td>
                <td className="py-3">{c.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>Identity documents</H2>
      <p>
        If you claim a fighter profile you may upload an identity document. We treat this as the
        most sensitive thing you can give us:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>It is stored in <b>private storage</b>. There is no public link to it, ever.</li>
        <li>Only you and our claim reviewers can open it, and <b>every time a reviewer opens it we record who and when</b>.</li>
        <li>
          It is <b>deleted from storage</b> — the file itself, not just the database row — as soon
          as your claim is decided: immediately on approval, 14 days after a rejection (so you can
          appeal), 30 days if you never finish the claim, and immediately if you delete your account.
        </li>
      </ul>

      <H2>Who else receives your data</H2>
      <p>
        We use the following processors. Those marked <i>not currently used</i> relate to features
        that are switched off — nothing is sent to them today, but we list them so this notice does
        not silently become wrong if a feature is enabled.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink-700 text-left text-fog">
              <th className="py-2 pr-4">Processor</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Where</th>
              <th className="py-2">What we send</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name} className="border-b border-ink-800 align-top">
                <td className="py-3 pr-4 font-semibold text-chalk">
                  {p.name}
                  {!p.active && <span className="ml-2 text-[0.65rem] font-normal text-fog">(not currently used)</span>}
                </td>
                <td className="py-3 pr-4">{p.role}</td>
                <td className="py-3 pr-4">{p.location}</td>
                <td className="py-3">
                  {p.dataSent}
                  {p.note && <span className="block text-fog">{p.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>International transfers</H2>
      <p>
        Some of these processors are in the United States. Where personal data leaves the UK/EEA we
        rely on the UK International Data Transfer Addendum / EU Standard Contractual Clauses with
        the processor concerned. If you want to see the safeguards for a specific processor, ask us
        at {legal.privacyEmail}.
      </p>

      <H2>Voice recordings</H2>
      <p>
        The voice-to-profile feature sends your recording to a third-party speech-to-text provider
        and the resulting transcript to an AI provider, both in the United States. It is{" "}
        <b>off by default</b>, you must give explicit consent before recording, and{" "}
        <b>we do not store the audio</b> — it is held in memory for the length of the request and
        then discarded.
      </p>

      <H2>Cookies</H2>
      <p>
        We set {COOKIES.length} cookies and no others. There is <b>no advertising and no third-party
        tracking</b> on this site; our product analytics are <b>first-party and cookieless</b> and
        store nothing on your device, which is why you have not been shown a consent banner: there is
        nothing optional to consent to. See the{" "}
        <a href="/cookies" className="text-blood-400 hover:text-blood-300">cookie policy</a> for the
        full list.
      </p>

      <H2>Your rights</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li><b>Access</b> — ask for a copy of your data. Email {legal.privacyEmail}; we respond within one month.</li>
        <li><b>Correction</b> — fix anything wrong, from your account settings or by asking us.</li>
        <li><b>Deletion</b> — delete your account from your account settings. This removes your data and destroys any identity document you uploaded.</li>
        <li><b>Objection and restriction</b> — tell us and we will stop, unless we have a legal reason not to.</li>
        <li><b>Portability</b> — ask us for your data in a portable format.</li>
        <li><b>Complain</b> — to us first, please. You can also complain to the UK Information Commissioner&apos;s Office at ico.org.uk.</li>
      </ul>
      <p className="text-fog">
        We do not currently offer a self-service data export. Email {legal.privacyEmail} and we will
        do it manually within one month, which is what the law requires.
      </p>

      <H2>Automated decisions</H2>
      <p>
        We do not make decisions about you by automated means alone. Fighter-profile claims are
        decided by a person, not by software.
      </p>

      <H2>Children</H2>
      <p>
        Combat Register is not intended for children. You must be at least 16 to hold an account. We
        do not knowingly collect identity documents, voice recordings or media from children — if
        you believe we have, tell us at {legal.privacyEmail} and we will delete it.
      </p>

      <H2>Changes</H2>
      <p>
        If we change how we handle your data we will update this notice and change the effective
        date below. This notice describes what the software does today.
      </p>
    </LegalPage>
  );
}
