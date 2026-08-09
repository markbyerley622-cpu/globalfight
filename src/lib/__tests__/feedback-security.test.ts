import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { isCategory, isStatus, CATEGORIES, STATUSES } from "../feedback/shared";

// ════════════════════════════════════════════════════════════════════════════
//  Feedback board — the structural guarantees.
//
//  The runtime behaviour (one vote per member, concurrent votes, hidden items
//  vanishing, the staff note staying private) is proven against a real database
//  in test/integration/feedback. These are the "no OTHER file may do X" rules,
//  which a runtime test cannot express: the risk is the route somebody adds
//  next month, not the ones that exist now.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(e))) out.push(full);
  }
  return out;
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");
const files = walk(SRC).filter((f) => !rel(f).includes("__tests__"));
const body = new Map(files.map((f) => [rel(f), strip(readFileSync(f, "utf8"))]));

describe("the vocabulary is closed", () => {
  test("only the declared categories and statuses are accepted", () => {
    for (const bad of ["", "ADMIN", "OPEN ", "idea", "<script>", "__proto__", "DROP TABLE"]) {
      assert.equal(isCategory(bad), false, `isCategory accepted ${JSON.stringify(bad)}`);
      assert.equal(isStatus(bad), false, `isStatus accepted ${JSON.stringify(bad)}`);
    }
    for (const c of CATEGORIES) assert.equal(isCategory(c), true);
    for (const s of STATUSES) assert.equal(isStatus(s), true);
  });

  test("non-strings are rejected rather than coerced", () => {
    for (const bad of [null, undefined, 1, {}, [], true]) {
      assert.equal(isCategory(bad), false);
      assert.equal(isStatus(bad), false);
    }
  });
});

describe("authorship and vote identity come from the session", () => {
  const svc = () => body.get("lib/feedback/index.ts")!;

  test("the service is reachable only with an explicit actor argument", () => {
    // Every mutating export takes the actor as its FIRST parameter, supplied by
    // the route from getCurrentUser()/requireAdminApi(). There is no variant
    // that reads an id out of a payload, which is what makes forged authorship
    // and forged voting inexpressible rather than merely blocked.
    for (const fn of ["createFeedback", "voteFeedback", "unvoteFeedback", "setStatus", "setHidden"]) {
      const m = svc().match(new RegExp(`export async function ${fn}\\(([^)]*)\\)`, "s"));
      assert.ok(m, `${fn} is gone from the feedback service`);
      const firstParam = m![1].split(",")[0].trim();
      assert.ok(
        /^(authorId|userId|staffId)\b/.test(firstParam),
        `${fn}'s first parameter is "${firstParam}" — the actor must be passed in, not read from input`,
      );
    }
  });

  test("no feedback route reads an author, user or reviewer id from the request", () => {
    for (const [path, src] of body) {
      if (!path.startsWith("app/api/") || !path.includes("feedback")) continue;
      for (const forbidden of [/body\.authorId/, /body\.userId/, /body\.staffId/, /body\.votes/, /body\.voteCount/]) {
        assert.ok(
          !forbidden.test(src),
          `${path} reads ${forbidden} off the request body — identity and counts come from the server`,
        );
      }
    }
  });

  test("the vote endpoint accepts no numeric input at all", () => {
    const route = body.get("app/api/feedback/[id]/vote/route.ts");
    assert.ok(route, "the vote route is gone");
    assert.ok(
      !/req\.json\(\)/.test(route),
      "the vote route now reads a body. It should not need one — a vote is the session plus the id in the path, " +
        "and any number it accepted would be a number it might trust.",
    );
  });
});

describe("staff-only surfaces guard themselves", () => {
  test("the admin feedback API calls requireAdminApi before anything else", () => {
    const route = body.get("app/api/admin/feedback/[id]/route.ts");
    assert.ok(route, "the admin feedback route is gone");
    assert.ok(/requireAdminApi\s*\(/.test(route), "the admin feedback route lost its guard");
    // Before the body is parsed: the authorisation decision must not depend on
    // anything the caller sent.
    assert.ok(
      route.indexOf("requireAdminApi") < route.indexOf("req.json"),
      "the admin route parses the request body before it authorises the caller",
    );
  });

  test("the admin feedback PAGE guards itself, not just via the layout", () => {
    // The App Router parallel-render bug this codebase already shipped once: a
    // layout's notFound() does not cancel the sibling page, which has already
    // run its queries. This page reads adminNote.
    const page = body.get("app/admin/feedback/page.tsx");
    assert.ok(page, "the admin feedback page is gone");
    assert.ok(
      /await\s+requireAdminPage\s*\(\s*\)/.test(page),
      "the admin feedback page reads the staff-only note with no guard of its own",
    );
  });

  test("the staff-only note is never selected by a public read", () => {
    const svc = body.get("lib/feedback/index.ts")!;
    // PUBLIC_SELECT is the projection every public path uses. If adminNote ever
    // appears in it, the note is on the board.
    const publicSelect = svc.slice(svc.indexOf("const PUBLIC_SELECT"), svc.indexOf("satisfies Prisma.FeedbackItemSelect"));
    assert.ok(publicSelect.length > 0, "PUBLIC_SELECT is gone — public reads have lost their projection");
    assert.ok(!/adminNote/.test(publicSelect), "adminNote is in the PUBLIC projection");
    assert.ok(!/\bemail\b/.test(publicSelect), "an author email is in the PUBLIC projection");
  });

  test("public reads always exclude hidden items", () => {
    const svc = body.get("lib/feedback/index.ts")!;
    for (const fn of ["listFeedback", "getFeedback", "similarFeedback"]) {
      const start = svc.indexOf(`export async function ${fn}`);
      assert.ok(start > -1, `${fn} is gone`);
      const chunk = svc.slice(start, start + 1400);
      assert.ok(
        /hiddenAt:\s*null/.test(chunk),
        `${fn} no longer filters out hidden items — moderation removals are back on the board`,
      );
    }
  });
});

describe("nothing renders feedback as markup", () => {
  test("no feedback component uses dangerouslySetInnerHTML", () => {
    // Titles and bodies are member-supplied. React escapes text nodes, and the
    // only way to undo that is this prop.
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (!path.includes("feedback")) continue;
      if (/dangerouslySetInnerHTML/.test(src)) offenders.push(path);
    }
    assert.deepEqual(offenders, [], "feedback content is being injected as HTML:\n  " + offenders.join("\n  "));
  });
});

describe("the write paths are moderated and bounded", () => {
  test("submission runs the shared moderation pipeline", () => {
    const svc = body.get("lib/feedback/index.ts")!;
    assert.ok(
      /assertPublishable\s*\(/.test(svc),
      "feedback no longer runs through the shared moderation service — a second implementation is the one that drifts",
    );
  });

  test("every feedback write route is rate limited", () => {
    for (const path of [
      "app/api/feedback/route.ts",
      "app/api/feedback/[id]/vote/route.ts",
      "app/api/admin/feedback/[id]/route.ts",
    ]) {
      const src = body.get(path);
      assert.ok(src, `${path} is gone`);
      assert.ok(/\bhit\s*\(/.test(src), `${path} has no rate limit`);
      // The limit must be keyed to the AUTHENTICATED account, never to
      // something the caller supplies (an IP is spoofable behind a proxy, and a
      // body field is free to change), or it resets itself.
      //
      // Checked as two facts rather than one regex over the key expression:
      // the route establishes an identity server-side, and the key interpolates
      // a variable rather than being a constant string shared by everyone. The
      // vote route keys through a `gate(userId)` helper, so matching on
      // `${user.id}` literally would fail on correct code.
      assert.ok(
        /getCurrentUser\s*\(|requireAdminApi\s*\(/.test(src),
        `${path} rate limits without establishing who the caller is`,
      );
      assert.ok(
        /`[\w-]+:\$\{[\w.]+\}`/.test(src),
        `${path}'s rate-limit key is a constant — one bucket for every caller is one caller's DoS`,
      );
    }
  });
});
