// Syntax-check every operator script.
//
// `tsc --noEmit` and `next build` do NOT cover scripts/*.mts — they are outside the
// app's tsconfig include and are never bundled. So a script could be committed,
// typechecked, built, linted and pushed while being unparseable, and the first person
// to find out was whoever ran it. That happened: a stray newline inside a string
// literal shipped green.
//
// esbuild is the same transformer tsx uses at runtime, so this is exactly the parse
// that would fail in the operator's terminal.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";

const dir = "scripts";
const files = readdirSync(dir).filter((f) => f.endsWith(".mts") || f.endsWith(".ts"));
let failed = 0;

for (const f of files) {
  const path = join(dir, f);
  try {
    transformSync(readFileSync(path, "utf8"), { loader: "ts", sourcefile: path });
    process.stdout.write(`  ok   ${path}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL ${path}\n`);
    for (const err of e.errors ?? [{ text: e.message }]) {
      const loc = err.location ? ` (${err.location.line}:${err.location.column})` : "";
      process.stdout.write(`       ${err.text}${loc}\n`);
    }
  }
}

if (failed) {
  process.stdout.write(`\n${failed} script(s) will not parse — they would fail the moment anyone ran them.\n`);
  process.exit(1);
}
process.stdout.write(`${files.length} scripts parse cleanly.\n`);
