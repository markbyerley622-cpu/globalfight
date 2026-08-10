// ════════════════════════════════════════════════════════════════════════════
//  Bump the Android release version.
//
//  Play REJECTS an upload whose versionCode it has already accepted, and the
//  rejection arrives after the upload, at the end of a build. This exists so
//  that "did I already ship code 4?" is answered by git rather than by memory.
//
//    npm run android:bump              → versionCode +1, versionName unchanged
//    npm run android:bump -- 1.1.0     → versionCode +1, versionName = 1.1.0
//
//  versionCode is a MONOTONIC COUNTER, not a derived number. It is deliberately
//  not derived from versionName (1.0.10 and 1.1.0 would collide under most
//  encodings), not from the commit count (rebases and squashes move it
//  backwards), and not from a timestamp (unreviewable, and the prompt for this
//  work explicitly ruled it out). One integer, one commit, one release.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "version.json");

interface Version { versionName: string; versionCode: number }

const current = JSON.parse(readFileSync(FILE, "utf8")) as Version;

const requested = process.argv[2]?.trim();
if (requested && !/^\d+\.\d+\.\d+$/.test(requested)) {
  console.error(
    `\n✖ "${requested}" is not a version name.\n\n` +
      "  Use MAJOR.MINOR.PATCH — it is shown to users in the Play listing and\n" +
      "  in Settings → Apps, so it should read like a version, not like a build\n" +
      "  id.\n",
  );
  process.exit(1);
}

const next: Version = {
  versionName: requested || current.versionName,
  versionCode: current.versionCode + 1,
};

writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);

console.log(
  `✔ android/version.json\n` +
    `    versionName   ${current.versionName} → ${next.versionName}\n` +
    `    versionCode   ${current.versionCode} → ${next.versionCode}\n\n` +
    `  Commit this, then regenerate and build:\n` +
    `    npm run android:manifest && cd android && bubblewrap build\n`,
);
