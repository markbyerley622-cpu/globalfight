"use client";

import { Swords, Trophy } from "lucide-react";
import { registerPreview, str, num, type PreviewViewProps } from "./registry";
import { PreviewActions, PreviewAction, PreviewFact, PreviewHeader, PreviewStats } from "./parts";

// ════════════════════════════════════════════════════════════════════════════
//  A FIGHTER — the registry row, not the account.
//
//  The record is rendered from three numbers rather than a pre-formatted
//  string, so "12-3-1" cannot arrive in one shape from ingest and another from
//  a manual edit. A missing count is genuinely unknown and the line is dropped
//  rather than printed as a zero, which would read as a losless debut record.
// ════════════════════════════════════════════════════════════════════════════

function FighterPreview({ preview }: PreviewViewProps) {
  const slug = str(preview.slug);
  const name = str(preview.name) ?? "Fighter";
  const nickname = str(preview.nickname);
  const wins = num(preview.wins);
  const losses = num(preview.losses);
  const draws = num(preview.draws);
  const record = wins !== null && losses !== null
    ? `${wins}-${losses}${draws ? `-${draws}` : ""}`
    : null;
  const ranking = num(preview.ranking);
  const division = str(preview.division);

  return (
    <div className="p-3">
      <PreviewHeader
        imageUrl={str(preview.imageUrl)}
        name={name}
        subtitle={nickname ? `“${nickname}”` : str(preview.sport)}
        round
        fallback={<Swords className="size-4 text-fog" aria-hidden />}
      />

      {record && (
        <PreviewFact icon={Swords}>
          <span className="font-semibold tabular-nums text-chalk">{record}</span>
          {division && <span className="text-fog"> · {division}</span>}
        </PreviewFact>
      )}

      {ranking !== null && (
        <PreviewFact icon={Trophy}>
          {ranking === 0 ? "Champion" : `Ranked #${ranking}`}
          {division && ranking !== 0 && <span className="text-fog"> at {division}</span>}
        </PreviewFact>
      )}

      <PreviewStats stats={[{ label: "Following", value: num(preview.followers) }]} />

      {slug && (
        <PreviewActions>
          <PreviewAction href={`/fighters/${slug}`} primary focusTarget>
            Open profile
          </PreviewAction>
        </PreviewActions>
      )}
    </div>
  );
}

registerPreview("fighter", FighterPreview);

export { FighterPreview };
