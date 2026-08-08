import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  EVERY rich-text surface behaves the same way.
//
//  ── Why this needs a test ─────────────────────────────────────────────────
//  A body that stores entities has to do FOUR things, and each one is a
//  separate call in a separate file:
//
//    write    resolveDraftEntities()  — handles in, ids stored
//    read     hydrateEntities()       — ids out, CURRENT handles rendered
//    render   <EntityText>            — segments, links, one renderer
//    notify   mentionedUserIds()      — ids, not a regex
//
//  Miss any one and the surface still works. That is the whole problem. Miss
//  `hydrate` and mentions render but stop surviving a rename — invisible until
//  somebody changes their handle months later. Miss `resolve` and the column is
//  simply never written, so the surface silently stays on the legacy parser
//  forever. Miss `EntityText` and the text renders as a string with no link,
//  which is what gym post BODIES did until this pass: the column existed, the
//  comment beneath it was fully wired, and the post itself printed `{post.body}`
//  into a <p>.
//
//  None of those produce an error, a type failure or a failing test anywhere
//  else. So the parity is asserted here, directly.
//
//  ── Why it is driven off the SCHEMA ───────────────────────────────────────
//  The last line of this file counts the `entities` columns in schema.prisma and
//  requires one SURFACE entry per column. Adding a fifth rich-text table without
//  wiring it up therefore fails here rather than shipping half-built — which is
//  exactly how gym post bodies came to have a column nothing read.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

interface Surface {
  name: string;
  /** Service layer: owns the write and the read. */
  repo: string;
  /** The component that renders the body. */
  view: string;
  /**
   * Where mention notifications are emitted from.
   *
   * Not always the repo: gym posts emit from lib/gym-posts/notify, the forum
   * from its own repo. What matters is that SOMETHING in the surface reads ids
   * rather than re-parsing the text.
   *
   * `null` = this surface deliberately does not notify. That is the ONE
   * permitted asymmetry and it must carry `noNotifyReason`.
   */
  notify: string | null;
  /** Required whenever `notify` is null. Documents the intentional difference. */
  noNotifyReason?: string;
}

const SURFACES: Surface[] = [
  {
    name: "Forum posts",
    repo: "lib/forum/repo.ts",
    view: "components/forums/thread-discussion.tsx",
    notify: "lib/forum/repo.ts",
  },
  {
    name: "Direct messages",
    repo: "lib/messages/repo.ts",
    view: "components/messages/message-thread.tsx",
    // The one intentional difference in the whole platform. A DM is private to
    // its two members: notifying a third party that they were NAMED inside one
    // would leak the fact that a private conversation discussed them, and the
    // notification's link would point into a thread they cannot open. Mentions
    // in a DM render and link; they never ping. See sendMessage.
    notify: null,
    noNotifyReason:
      "a DM is private to two people — naming a third party must not tell them, " +
      "nor hand them a link into a conversation they are not a member of",
  },
  {
    name: "Gym posts",
    repo: "lib/gym-posts/repo.ts",
    view: "components/gym-posts/gym-post-card.tsx",
    notify: "lib/gym-posts/notify.ts",
  },
  {
    name: "Gym post comments",
    repo: "lib/gym-posts/repo.ts",
    view: "components/gym-posts/comment-thread.tsx",
    notify: "lib/gym-posts/notify.ts",
  },
];

describe("every rich-text surface runs the whole pipeline", () => {
  for (const s of SURFACES) {
    describe(s.name, () => {
      test("writes through resolveDraftEntities — ids are stored, not handles", () => {
        assert.ok(
          read(s.repo).includes("resolveDraftEntities"),
          `${s.name}: ${s.repo} never calls resolveDraftEntities, so its entities\n` +
            "column is never written and the surface stays on the legacy parser.",
        );
      });

      test("reads through hydrateEntities — a rename reaches historical content", () => {
        const body = read(s.repo);
        assert.ok(
          body.includes("hydrateEntities") || body.includes("hydrateOne"),
          `${s.name}: ${s.repo} never hydrates. Mentions would render with the\n` +
            "handle frozen at write time, so a rename orphans every one of them.",
        );
      });

      test("renders through EntityText — one renderer, no second implementation", () => {
        assert.ok(
          read(s.view).includes("EntityText"),
          `${s.name}: ${s.view} does not use EntityText. Printing the body as a\n` +
            "string makes every mention in it unclickable — see this file's header.",
        );
      });

      test("notifies from ids, via mentionedUserIds — or documents why it does not", () => {
        if (s.notify === null) {
          // An opt-out has to say why, in the table, where the next person to
          // read it will find the reason beside the exception.
          assert.ok(
            s.noNotifyReason && s.noNotifyReason.length > 20,
            `${s.name} opts out of mention notifications without a reason. ` +
              "Set noNotifyReason to the actual argument.",
          );
          // And it must genuinely not notify — an opt-out that quietly grew a
          // notifier is the drift this table exists to catch.
          assert.ok(
            !read(s.repo).includes("mentionedUserIds"),
            `${s.name} is listed as never notifying mentions, but ${s.repo} now ` +
              "reads mentionedUserIds. Either that is a privacy regression, or " +
              "the table is stale — decide which.",
          );
          return;
        }

        assert.ok(
          read(s.notify).includes("mentionedUserIds"),
          `${s.name}: ${s.notify} does not read mentionedUserIds, so the notifier\n` +
            "is guessing from text and can disagree with what was rendered.",
        );
      });
    });
  }
});

describe("the surface list is complete", () => {
  test("one wired surface per entities column in the schema", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    // The column declaration itself, not the doc comments above it.
    const columns = schema.match(/^\s*entities\s+Json\?/gm) ?? [];

    assert.equal(
      columns.length,
      SURFACES.length,
      `schema.prisma declares ${columns.length} entities columns but only ` +
        `${SURFACES.length} surfaces are wired here.\n` +
        "A new rich-text table must write, read, render and notify before it ships —\n" +
        "add it to SURFACES above and make the four assertions pass.",
    );
  });

  test("the check is not vacuous — every listed file exists", () => {
    for (const s of SURFACES) {
      for (const rel of [s.repo, s.view, s.notify].filter((r): r is string => r !== null)) {
        assert.doesNotThrow(() => read(rel), `SURFACES points at ${rel}, which does not exist`);
      }
    }
  });
});
