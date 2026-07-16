import { LegalPage, H2 } from "@/components/legal/legal-page";
import { INGESTION_SOURCES } from "@/lib/ingestion-registry";

export const metadata = { title: "Data Sources" };
export const dynamic = "force-dynamic";

/** Rendered from the enforced ingestion registry — this page cannot drift from the code. */
export default function DataSourcesPage() {
  const enabled = INGESTION_SOURCES.filter((s) => s.enabled);
  const disabled = INGESTION_SOURCES.filter((s) => !s.enabled);

  return (
    <LegalPage
      title="Data Sources"
      intro="Where our data comes from, on what basis, and what we deliberately do not use."
    >
      <H2>Sources we use</H2>
      {enabled.map((s) => (
        <div key={s.id} className="rounded-lg border border-ink-800 p-4">
          <p className="font-display font-bold text-chalk">{s.name}</p>
          <p className="mt-1 text-xs text-fog">{s.host} · {s.method} · {s.frequency}</p>
          <p className="mt-2">{s.basis}</p>
          {s.attribution && <p className="mt-1 text-fog">Attribution: {s.attribution}</p>}
          {s.note && <p className="mt-1 text-fog">{s.note}</p>}
        </div>
      ))}

      <H2>Sources we do not use</H2>
      <p>
        We list these because their absence is deliberate. Each was either never licensed or has been
        withdrawn, and the code will refuse to run them.
      </p>
      {disabled.map((s) => (
        <div key={s.id} className="rounded-lg border border-ink-800/60 p-4 opacity-80">
          <p className="font-display font-semibold text-mist">{s.name}</p>
          <p className="mt-1 text-xs text-fog">{s.host}</p>
          {s.note && <p className="mt-2 text-fog">{s.note}</p>}
        </div>
      ))}

      <H2>Rankings</H2>
      <p>
        We do not currently publish rankings. Our previous ranking data could not be traced to a
        licensed source, so it was withdrawn and deleted. Rankings will return when we have a source
        we are entitled to use.
      </p>

      <H2>Photography</H2>
      <p>
        We do not publish third-party photography. Fighter images are neutral generated placeholders
        until we have photographs we own or are licensed to use, with the attribution the licence
        requires. If you are a fighter, you can upload your own photograph to your claimed profile.
      </p>

      <H2>Corrections</H2>
      <p>
        If something here is wrong, or you believe we are using your data or imagery without
        permission, please tell us — see the{" "}
        <a href="/copyright" className="text-blood-400 hover:text-blood-300">copyright page</a>.
      </p>
    </LegalPage>
  );
}
