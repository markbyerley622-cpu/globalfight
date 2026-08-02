// End-to-end smoke test for direct messages, against the REAL database.
//
//   npm run dm:smoke
//
// It proves the properties that matter and that a unit test cannot reach,
// because they are enforced by Postgres rather than by TypeScript:
//
//   • opening the same pair twice returns ONE conversation, from either side
//   • a non-member gets null, indistinguishable from "no such conversation"
//   • unread is a watermark: it counts the other person's newer messages only
//   • sending marks your own side read
//
// It creates its own throwaway users, and deletes them (and everything that
// cascades from them) at the end — including on failure.
import { prisma } from "../src/lib/db.ts";
import {
  openConversation, sendMessage, getConversation, listConversations,
  unreadMessageCount, markRead, pairKeyFor,
} from "../src/lib/messages/repo.ts";

const STAMP = `dmsmoke-${Date.now()}`;
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function mkUser(tag: string) {
  return prisma.user.create({
    data: {
      email: `${STAMP}-${tag}@example.invalid`,
      username: `${STAMP}-${tag}`,
      name: `Smoke ${tag}`,
      passwordHash: "not-a-real-hash",
    },
    select: { id: true, username: true },
  });
}

async function main() {
  console.log("\n  Direct messages — live smoke test\n");

  const [alice, bob, carol] = await Promise.all([mkUser("alice"), mkUser("bob"), mkUser("carol")]);

  // ── identity ─────────────────────────────────────────────────────────────
  check("pairKey is orientation-independent",
    pairKeyFor(alice.id, bob.id) === pairKeyFor(bob.id, alice.id));

  const c1 = await openConversation(alice.id, bob.id);
  const c2 = await openConversation(bob.id, alice.id);
  check("opening from both sides yields ONE conversation", c1 === c2, `${c1} vs ${c2}`);

  const total = await prisma.conversation.count({ where: { pairKey: pairKeyFor(alice.id, bob.id) } });
  check("exactly one row exists for the pair", total === 1, `found ${total}`);

  let selfRefused = false;
  try { await openConversation(alice.id, alice.id); } catch { selfRefused = true; }
  check("messaging yourself is refused", selfRefused);

  // ── send + read ──────────────────────────────────────────────────────────
  await sendMessage(c1, alice.id, "First.");
  await sendMessage(c1, alice.id, "Second.");

  const bobUnread = await unreadMessageCount(bob.id);
  check("recipient sees both messages unread", bobUnread === 2, `got ${bobUnread}`);

  const aliceUnread = await unreadMessageCount(alice.id);
  check("sender's own messages are not unread to them", aliceUnread === 0, `got ${aliceUnread}`);

  await markRead(c1, bob.id);
  check("reading clears the watermark", (await unreadMessageCount(bob.id)) === 0);

  await sendMessage(c1, alice.id, "Third, after Bob read.");
  const afterRead = await unreadMessageCount(bob.id);
  check("only messages NEWER than the watermark count", afterRead === 1, `got ${afterRead}`);

  await sendMessage(c1, bob.id, "Replying.");
  check("sending marks your own side read", (await unreadMessageCount(bob.id)) === 0);

  // ── ordering + membership ────────────────────────────────────────────────
  const view = await getConversation(c1, alice.id);
  check("thread renders oldest-first", view?.messages[0]?.body === "First.", view?.messages[0]?.body);
  check("thread names the OTHER person", view?.withUser?.id === bob.id);

  const intruder = await getConversation(c1, carol.id);
  check("a non-member gets null, not a forbidden-vs-missing oracle", intruder === null);

  let intruderSend = false;
  try { await sendMessage(c1, carol.id, "let me in"); } catch { intruderSend = true; }
  check("a non-member cannot send into the thread", intruderSend);

  const carolInbox = await listConversations(carol.id);
  check("a non-member's inbox does not contain it", carolInbox.length === 0, `got ${carolInbox.length}`);

  const aliceInbox = await listConversations(alice.id);
  check("the inbox shows the last message", aliceInbox[0]?.lastMessage?.body === "Replying.",
    aliceInbox[0]?.lastMessage?.body);
  check("the inbox names the other person", aliceInbox[0]?.withUser.id === bob.id);
}

try {
  await main();
} finally {
  // Cascades remove ConversationMember + DirectMessage; the Conversation row is
  // then orphaned, so it goes explicitly.
  const users = await prisma.user.findMany({
    where: { username: { startsWith: STAMP } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const convos = await prisma.conversation.findMany({
      where: { members: { some: { userId: { in: ids } } } },
      select: { id: true },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`\n  cleaned up ${ids.length} smoke users`);
  await prisma.$disconnect();
}

if (failures) {
  console.error(`\n  ${failures} check(s) FAILED\n`);
  process.exit(1);
}
console.log("\n  all checks passed\n");
