// One-off: sanitize already-ingested articles.
//   node --import tsx scripts/news-clean.mts
//
// Google News RSS wraps its <description> as escaped HTML (&lt;a href=…&gt;), which
// the old strip() left behind as raw `a href="…"` link text in excerpt/content.
// That text is unrecoverable (the description was only a relinked title), so junk
// excerpts are dropped and content falls back to the title. Titles also lose the
// " - Publisher" suffix Google appends. Slugs are left alone (they're the key).
import { prisma } from "../src/lib/db.ts";

const JUNK = /(https?:\/\/|www\.|\bhref=|\.com\/)/i;
const cleanTitle = (t: string) => t.replace(/\s+[-–—]\s+[^-–—]{1,45}$/, "").trim();

const arts = await prisma.article.findMany({ select: { id: true, title: true, excerpt: true, content: true } });
let changed = 0;
for (const a of arts) {
  const title = cleanTitle(a.title) || a.title;
  const excerptJunk = !!a.excerpt && JUNK.test(a.excerpt);
  const contentJunk = !!a.content && JUNK.test(a.content);
  if (title === a.title && !excerptJunk && !contentJunk) continue;
  await prisma.article.update({
    where: { id: a.id },
    data: {
      title,
      excerpt: excerptJunk ? null : a.excerpt,
      content: contentJunk ? title : a.content,
    },
  });
  changed++;
}
console.log(`cleaned ${changed} of ${arts.length} articles`);
await prisma.$disconnect();
