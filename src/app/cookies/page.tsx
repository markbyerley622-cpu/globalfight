import { LegalPage, H2 } from "@/components/legal/legal-page";
import { COOKIES, hasOptionalCookies } from "@/lib/privacy-inventory";

export const metadata = { title: "Cookie Policy" };
export const dynamic = "force-dynamic";

/** Rendered from the actual cookie inventory — not a template. */
export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" intro="Every cookie this site sets, and why.">
      <H2>The short version</H2>
      <p>
        We set <b>{COOKIES.length}</b> cookies. There is <b>no analytics, no advertising, and no
        third-party tracking</b> on this site.
      </p>
      <p>
        That is why you have not been shown a cookie banner. Under PECR, consent is required for
        optional cookies — and we do not set any. Showing you a banner that consents to nothing
        would be theatre, so we have not added one.
      </p>
      <p className="text-fog">
        If we ever add analytics, this changes: optional cookies would default to OFF, nothing would
        load before you agreed, and declining would be exactly as easy as accepting.
      </p>

      <H2>The cookies we set</H2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink-700 text-left text-fog">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Purpose</th>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2">Retention</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((c) => (
              <tr key={c.name} className="border-b border-ink-800 align-top">
                <td className="py-3 pr-4 font-mono text-chalk">{c.name}</td>
                <td className="py-3 pr-4">{c.category}</td>
                <td className="py-3 pr-4">{c.purpose}</td>
                <td className="py-3 pr-4">{c.provider}</td>
                <td className="py-3">{c.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasOptionalCookies() && (
        <p className="text-blood-300">
          Optional cookies are present — a consent mechanism is required and must be shown.
        </p>
      )}

      <H2>Third-party embeds</H2>
      <p>
        Where we embed a YouTube video we use youtube-nocookie.com, which does not set tracking
        cookies unless you press play. Social embeds use each platform&apos;s official script and may
        set their own cookies once loaded.
      </p>

      <H2>Managing cookies</H2>
      <p>
        You can clear or block cookies in your browser. If you block our session cookie you will not
        be able to sign in — it is what keeps you logged in.
      </p>
    </LegalPage>
  );
}
