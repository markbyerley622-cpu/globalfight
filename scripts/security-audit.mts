/**
 * Prisma private-data query auditor.
 *
 * A release-grade static analyser (NOT a grep) that proves whether every query
 * touching user-owned data is scoped to the authenticated user. It parses the
 * Prisma schema to classify models, walks the TypeScript AST of the whole
 * codebase to find every `prisma.*` / `tx.*` call, inspects each call's `where`
 * for an ownership filter, and scores the risk — then writes a human report
 * (security/query-audit.md) and a machine report (security/query-audit.json).
 *
 * Zero runtime dependencies beyond the TypeScript compiler (already a dep). Run:
 *   npm run security:audit            # write reports
 *   npm run security:audit -- --fail-on-high   # exit 1 if any HIGH finding (CI)
 *
 * It is an AUDITOR: it never edits application code. Evidence first.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const SCHEMA = join(ROOT, "prisma", "schema.prisma");

// ── Model classification ──────────────────────────────────────────────────────
// A field alone can't classify (Fighter has ownerId but is public), so we curate
// the known models and fall back to an ownership-field heuristic for the rest —
// clearly flagging which were auto-classified so a human can refine.

type Klass = "PUBLIC" | "USER_OWNED" | "SHARED" | "ADMIN";

const CURATED: Record<string, Klass> = {
  // Public content — world-readable by design.
  Fighter: "PUBLIC", Fight: "PUBLIC", Event: "PUBLIC", Promotion: "PUBLIC",
  Gym: "PUBLIC", GymPhoto: "PUBLIC", GymReview: "PUBLIC", Article: "PUBLIC",
  ArticleTag: "PUBLIC", ForumThread: "PUBLIC", ForumPost: "PUBLIC",
  ForumReaction: "PUBLIC", Ranking: "PUBLIC", WeightClass: "PUBLIC",
  Community: "PUBLIC", Video: "PUBLIC", OddsSnapshot: "PUBLIC", Podcast: "PUBLIC",
  // Gym posts. Classified alongside ForumPost/GymReview — public read, owner-only
  // write, enforced in the service layer (lib/gym-posts/visibility).
  //
  // The auto-classifier calls these USER_OWNED because they carry an authorId,
  // which is the same false positive Fighter's ownerId would produce: an author
  // column means "who wrote it", not "who may read it". Classifying them here is
  // what CLAUDE.md's "when you add a table, place it in the RLS classification"
  // step is for, and leaving them auto-classified would bury 20 expected findings
  // in the MEDIUM list where a real one could hide.
  //
  // NOTE: GymPost is the first PUBLIC model with PER-ROW visibility (a MEMBERS or
  // PRIVATE post is not world-readable). The read path is still centralised —
  // every read goes through getFeed/getPost, which apply the visibility filter in
  // SQL and re-apply the pure predicate to each row — so the app-layer control
  // this classification assumes does hold. It is called out because an RLS policy
  // for this table will need the visibility column, not just an owner match.
  GymPost: "PUBLIC", GymPostComment: "PUBLIC",
  GymPostReaction: "PUBLIC", GymPostCommentReaction: "PUBLIC",
  GymPostMedia: "PUBLIC",
  // User-owned — must always be owner-scoped on read.
  Notification: "USER_OWNED", FightPick: "USER_OWNED", Session: "USER_OWNED",
  Account: "USER_OWNED", PushSubscription: "USER_OWNED", PasswordResetToken: "USER_OWNED",
  ForumBookmark: "USER_OWNED", ForumSubscription: "USER_OWNED", CheckIn: "USER_OWNED",
  FavoriteEvent: "USER_OWNED", FavoriteFighter: "USER_OWNED", FavoritePromotion: "USER_OWNED",
  AnalyticsEvent: "USER_OWNED", Activity: "USER_OWNED", ReputationEvent: "USER_OWNED",
  CardAward: "USER_OWNED", UserFollow: "USER_OWNED", GymReviewVote: "USER_OWNED",
  // UserBlock is owned by the BLOCKER. The enforcement predicate deliberately
  // reads the reverse leg too (lib/blocks/repo `blockExistsBetween`), which is a
  // read of a row the viewer does not own — that is the one intended exception
  // and it returns a boolean, never the row.
  UserBlock: "USER_OWNED",
  // Shared — relationship must be validated.
  Battle: "SHARED", Rivalry: "SHARED", GymMember: "SHARED", GymClaim: "SHARED",
  FighterClaim: "SHARED", CopyrightReport: "SHARED", Prediction: "SHARED",
  CommunityVote: "SHARED", CommunityMember: "SHARED",
};

const OWNER_FIELDS = ["userId", "authorId", "ownerId", "uploadedById", "createdById"];

interface ModelInfo { name: string; klass: Klass; auto: boolean; ownerFields: string[] }

function parseSchema(): Map<string, ModelInfo> {
  const text = readFileSync(SCHEMA, "utf8");
  const models = new Map<string, ModelInfo>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    const body = m[2];
    const ownerFields = OWNER_FIELDS.filter((f) => new RegExp(`^\\s*${f}\\s`, "m").test(body));
    let klass = CURATED[name];
    const auto = !klass;
    if (!klass) klass = ownerFields.length ? "USER_OWNED" : "PUBLIC";
    models.set(name, { name, klass, auto, ownerFields });
  }
  return models;
}

// ── Query detection (AST) ─────────────────────────────────────────────────────

const READ = new Set(["findMany", "findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE = new Set(["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"]);
const AGGREGATE = new Set(["count", "aggregate", "groupBy"]); // row totals, not row exposure
// Looked up by a CREDENTIAL/ENDPOINT server-side (token hash, push endpoint), never
// by "the current viewer" — a userId filter would be wrong here, so these are not
// user-facing reads and must not read as leaks.
const AUTH_INTERNAL = new Set(["PasswordResetToken", "Session", "Account", "PushSubscription", "EmailVerificationToken"]);
const PRISMA_BASES = new Set(["prisma", "tx", "db", "client"]);
// `block` covers UserBlock's blockerId/blockedId — the only two columns in the
// schema with that prefix, so this recognises a scoped read on that table
// without loosening the rule for any other. Both legs count: a UserBlock row
// names two people and the viewer is always one of them, so filtering on either
// id IS the ownership filter. (`blockExistsBetween` still reports as unscoped
// and should: its `where` is a bare OR, which no static reader can attribute.)
const OWNER_KEY_RE = /(^|_)(user|author|owner|member|participant|follower|following|challenger|opponent|sender|recipient|created|uploaded|block)/i;
const AUTH_MARKERS = ["getCurrentUser", "getSessionUserId", "requireUser", "requireStaff", "requireAdmin", "isAdmin", "assertAdmin"];

type Sev = "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface Finding {
  file: string; line: number; fn: string;
  model: string; method: string; klass: Klass;
  kind: "read" | "write";
  ownership: "scoped" | "unscoped" | "unknown";
  severity: Sev; confidence: "high" | "medium" | "low";
  why: string;
}

/** Collect every property-key name that appears anywhere inside a `where` object
 *  literal — this catches nested filters, composite uniques (userId_fightId) and
 *  OR/AND arrays without special-casing each. */
function collectKeys(node: ts.Node, out: Set<string>) {
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
    const n = node.name;
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) out.add(n.text);
  }
  node.forEachChild((c) => collectKeys(c, out));
}

function enclosingFn(node: ts.Node): string {
  let n: ts.Node | undefined = node;
  while (n) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && n.name && ts.isIdentifier(n.name)) return n.name.text;
    n = n.parent;
  }
  return "<module>";
}

function baseName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text; // this.prisma → "prisma"
  return null;
}

function analyzeFile(file: string, models: Map<string, ModelInfo>, findings: Finding[]) {
  const text = readFileSync(file, "utf8");
  const hasAuth = AUTH_MARKERS.some((a) => text.includes(a));
  const isAdminPath = /[\\/]admin[\\/]/.test(file) || /[\\/]api[\\/]cron[\\/]/.test(file);
  const kind = extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const modelAccess = node.expression.expression; // prisma.notification
      if ((READ.has(method) || WRITE.has(method)) && ts.isPropertyAccessExpression(modelAccess)) {
        const base = baseName(modelAccess.expression);
        if (base && PRISMA_BASES.has(base)) {
          const accessor = modelAccess.name.text; // camelCase model
          const modelName = accessor.charAt(0).toUpperCase() + accessor.slice(1);
          const info = models.get(modelName);
          if (info) {
            record(node, sf, file, method, info, hasAuth, isAdminPath, findings);
          }
        }
      }
    }
    node.forEachChild(visit);
  }
  visit(sf);
}

function record(
  call: ts.CallExpression, sf: ts.SourceFile, file: string, method: string,
  info: ModelInfo, hasAuth: boolean, isAdminPath: boolean, findings: Finding[],
) {
  const isWrite = WRITE.has(method);
  const isAggregate = AGGREGATE.has(method);
  const { line } = sf.getLineAndCharacterOfPosition(call.getStart(sf));

  // Inspect the first argument's `where` for an ownership key.
  let ownership: Finding["ownership"] = "unscoped";
  const arg0 = call.arguments[0];
  if (arg0 && ts.isObjectLiteralExpression(arg0)) {
    const whereProp = arg0.properties.find(
      (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name) && p.name.text === "where",
    );
    if (whereProp && ts.isPropertyAssignment(whereProp)) {
      if (ts.isObjectLiteralExpression(whereProp.initializer)) {
        const keys = new Set<string>();
        collectKeys(whereProp.initializer, keys);
        ownership = [...keys].some((k) => OWNER_KEY_RE.test(k)) ? "scoped" : "unscoped";
      } else {
        ownership = "unknown"; // where is a variable/spread — can't prove statically
      }
    } else if (method === "create" || method === "createMany") {
      ownership = "scoped"; // create sets its own owner via data, no where needed
    }
  } else if (method === "create" || method === "createMany") {
    ownership = "scoped";
  } else if (arg0) {
    ownership = "unknown"; // args is a variable
  }

  const fn = enclosingFn(call);
  // The real attack surface is a request handler. A library/job function is only
  // as unsafe as its callers, so an unscoped private read there is "review the
  // callers" (MEDIUM), while the same in an API route is a direct leak (HIGH).
  const inApiRoute = /[\\/]app[\\/]api[\\/]/.test(file);
  let severity: Sev = "INFO";
  let confidence: Finding["confidence"] = "high";
  let why = "";

  if (AUTH_INTERNAL.has(info.name)) {
    severity = "LOW";
    why = "Auth-internal table — accessed by credential/endpoint server-side, not by viewer id. A userId filter would be incorrect here; confirm it isn't returned to clients.";
  } else if (info.klass === "PUBLIC") {
    severity = isWrite && ownership === "unscoped" ? "LOW" : "INFO";
    why = isWrite ? "Public model write — relies on app-layer auth (expected)." : "Public model read — world-readable by design.";
  } else if (isAggregate && info.klass !== "ADMIN") {
    severity = "INFO";
    why = "Aggregate (count/aggregate/groupBy) — returns totals, not individual rows.";
  } else if (info.klass === "USER_OWNED") {
    if (ownership === "scoped") { severity = "INFO"; why = "Owner-scoped read/write on a private model."; }
    else if (ownership === "unknown") { severity = "MEDIUM"; confidence = "medium"; why = "Private model; `where` is dynamic — ownership can't be proven statically. Confirm the variable is user-scoped."; }
    else if (inApiRoute) { severity = "HIGH"; why = `Private model ${isWrite ? "write" : "read"} in an API route with NO ownership filter. Direct cross-user ${isWrite ? "mutation" : "leak"} risk.`; }
    else { severity = "MEDIUM"; confidence = "medium"; why = `Private model ${isWrite ? "write" : "read"} with no ownership filter in a library/job. Not a leak by itself — verify every caller scopes by user (bulk fan-out/aggregate jobs are expected here).`; }
  } else if (info.klass === "SHARED") {
    if (ownership === "scoped") { severity = "INFO"; why = "Shared model with a relationship/owner filter."; }
    else if (ownership === "unknown") { severity = "MEDIUM"; confidence = "medium"; why = "Shared model; dynamic `where` — verify the caller validates the relationship."; }
    else { severity = "MEDIUM"; why = "Shared model with no relationship filter — confirm both parties' access is validated."; }
  } else if (info.klass === "ADMIN") {
    severity = hasAuth || isAdminPath ? "INFO" : "MEDIUM";
    why = hasAuth || isAdminPath ? "Admin model in a staff-guarded context." : "Admin model outside an obvious staff guard — confirm role check.";
  }

  // De-noise: a private read with no filter but inside an admin/cron/staff-guarded
  // file is likely an intentional operator query, not a user-facing leak.
  if (severity === "HIGH" && (isAdminPath || (info.klass !== "USER_OWNED" && hasAuth))) {
    severity = "MEDIUM"; confidence = "medium";
    why += " (Downgraded: admin/cron or staff-guarded file.)";
  }

  findings.push({
    file: relative(ROOT, file).replace(/\\/g, "/"), line: line + 1, fn,
    model: info.name, method, klass: info.klass,
    kind: isWrite ? "write" : "read", ownership, severity, confidence, why,
  });
}

// ── Walk + report ─────────────────────────────────────────────────────────────

function walk(dir: string, files: string[]) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "__tests__" || e.startsWith(".")) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, files);
    else if ((extname(p) === ".ts" || extname(p) === ".tsx") && !p.endsWith(".d.ts") && !p.includes(".test.")) files.push(p);
  }
}

function main() {
  const failOnHigh = process.argv.includes("--fail-on-high");
  const models = parseSchema();
  const files: string[] = [];
  walk(SRC, files);

  const findings: Finding[] = [];
  for (const f of files) {
    try { analyzeFile(f, models, findings); } catch { /* skip unparseable */ }
  }

  const order: Sev[] = ["HIGH", "MEDIUM", "LOW", "INFO"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);

  const by = (s: Sev) => findings.filter((f) => f.severity === s);
  const high = by("HIGH"), medium = by("MEDIUM");
  const byKlass = (k: Klass) => findings.filter((f) => f.klass === k).length;

  const outDir = join(ROOT, "security");
  mkdirSync(outDir, { recursive: true });

  // JSON (machine / CI)
  writeFileSync(join(outDir, "query-audit.json"), JSON.stringify({
    generatedFrom: "scripts/security-audit.mts",
    totals: {
      queries: findings.length, high: high.length, medium: medium.length,
      low: by("LOW").length, info: by("INFO").length,
      public: byKlass("PUBLIC"), userOwned: byKlass("USER_OWNED"), shared: byKlass("SHARED"), admin: byKlass("ADMIN"),
    },
    models: [...models.values()],
    findings,
  }, null, 2));

  // Markdown (human)
  const md: string[] = [];
  md.push("# Private-data query audit\n");
  md.push("> Generated by `scripts/security-audit.mts` (AST analysis of every `prisma.*`/`tx.*` call). Regenerate with `npm run security:audit`.\n");
  md.push("## Executive summary\n");
  md.push(`- **Queries analysed:** ${findings.length} across ${files.length} files`);
  md.push(`- **By class:** ${byKlass("PUBLIC")} public · ${byKlass("USER_OWNED")} user-owned · ${byKlass("SHARED")} shared · ${byKlass("ADMIN")} admin`);
  md.push(`- **Risk:** 🔴 ${high.length} high · 🟠 ${medium.length} medium · 🟡 ${by("LOW").length} low · ⚪ ${by("INFO").length} info\n`);

  const row = (f: Finding) => `| \`${f.file}:${f.line}\` | ${f.fn} | ${f.model} (${f.klass}) | ${f.method} · ${f.ownership} | ${f.why} |`;

  md.push("## 🔴 High risk\n");
  if (!high.length) md.push("_None._ No private-model read/write was found without an ownership filter.\n");
  else { md.push("| Location | Function | Model | Query | Why |"); md.push("|---|---|---|---|---|"); high.forEach((f) => md.push(row(f))); md.push(""); }

  md.push("## 🟠 Medium risk (ownership not statically provable)\n");
  if (!medium.length) md.push("_None._\n");
  else { md.push("| Location | Function | Model | Query | Why |"); md.push("|---|---|---|---|---|"); medium.slice(0, 200).forEach((f) => md.push(row(f))); if (medium.length > 200) md.push(`\n_…and ${medium.length - 200} more (see JSON)._`); md.push(""); }

  md.push("## Model classification\n");
  md.push("| Model | Class | Source |"); md.push("|---|---|---|");
  [...models.values()].sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name))
    .forEach((m) => md.push(`| ${m.name} | ${m.klass} | ${m.auto ? "auto (heuristic)" : "curated"} |`));
  md.push("");

  md.push("## Recommendations\n");
  md.push("- Treat every 🔴 as a release blocker; add an ownership filter or prove the caller enforces it.");
  md.push("- Reduce 🟠 by passing literal `where` at the query site, or by centralising private reads behind repository helpers that take a `userId` argument (so ownership is structural, not per-call).");
  md.push("- Wire `npm run security:audit -- --fail-on-high` into CI to block regressions.");
  md.push("- This is defence-in-depth alongside DB row-level security (see `docs/SECURITY-RLS.md`).\n");

  writeFileSync(join(outDir, "query-audit.md"), md.join("\n"));

  console.log(`Analysed ${findings.length} queries in ${files.length} files → security/query-audit.{md,json}`);
  console.log(`HIGH: ${high.length}  MEDIUM: ${medium.length}  LOW: ${by("LOW").length}  INFO: ${by("INFO").length}`);
  if (failOnHigh && high.length) { console.error(`\n✗ ${high.length} HIGH-risk quer${high.length === 1 ? "y" : "ies"} — failing.`); process.exit(1); }
}

main();
