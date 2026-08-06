import type { Visibility } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  WHO MAY DO WHAT TO A GYM POST. Pure — no database, no request, no session.
//
//  ── The rule this file exists to hold ────────────────────────────────────
//  Authorization is answered from the POST (its gym, its author, its
//  visibility) and the VIEWER's relationship to that gym. It is never answered
//  from the attached media.
//
//  That is not a stylistic preference. MediaAsset.ownerId is who UPLOADED the
//  bytes, and assets are deduplicated — two people who upload the same photo
//  share one row, and the row records whoever got there first. Deriving any
//  permission from it would mean the first uploader of a common image silently
//  acquires rights over every later post that happens to attach it. The asset
//  is storage. Permission is domain. They never meet.
//
//  ── Why edit and delete are different rights ─────────────────────────────
//  Only the AUTHOR may edit. A gym owner and a moderator may DELETE, and that
//  is the whole of their power over someone else's words: removal is a
//  moderation act with an audit trail, editing would be putting words in
//  another person's mouth under their name and face. Collapsing the two into
//  one "canModerate" boolean is how that happens by accident.
//
//  Pure so it can be exhaustively unit-tested — every (visibility × viewer)
//  combination, with no fixtures — and so the API layer and any future server
//  component cannot disagree about the answer.
// ════════════════════════════════════════════════════════════════════════════

/** The post's own facts. Nothing about its media appears here, on purpose. */
export interface PostSubject {
  authorId: string;
  gymId: string;
  visibility: Visibility;
  /** Soft-deleted posts are invisible through the API to everyone. */
  deletedAt: Date | null;
}

/** The viewer's relationship to the gym in question. */
export interface Viewer {
  /** Null for anonymous. */
  id: string | null;
  /** Moderator or admin. From User.role via isAdminRole — never registryRole. */
  isStaff: boolean;
  /** Holds a GymMember row for this post's gym. */
  isMember: boolean;
  /** Gym.ownerId === viewer.id. */
  isGymOwner: boolean;
}

export const ANONYMOUS: Viewer = { id: null, isStaff: false, isMember: false, isGymOwner: false };

const isAuthor = (p: PostSubject, v: Viewer) => v.id !== null && v.id === p.authorId;

/**
 * May this viewer READ the post?
 *
 * A soft-deleted post is gone for everybody here, including its author and
 * including staff. Moderators review removed content through the moderation
 * console, which reads the row directly and logs that it did — a read path that
 * quietly resurrects deleted content for privileged users is how "deleted"
 * stops meaning anything.
 */
export function canViewPost(p: PostSubject, v: Viewer): boolean {
  if (p.deletedAt) return false;
  switch (p.visibility) {
    case "PUBLIC":
      return true;
    case "MEMBERS":
      return isAuthor(p, v) || v.isMember || v.isGymOwner || v.isStaff;
    case "PRIVATE":
      return isAuthor(p, v) || v.isGymOwner || v.isStaff;
    default:
      // An unknown value from a newer deploy fails CLOSED. The alternative —
      // defaulting to PUBLIC — publishes something during a rollout.
      return false;
  }
}

/** Only the author. See the header. */
export function canEditPost(p: PostSubject, v: Viewer): boolean {
  return !p.deletedAt && isAuthor(p, v);
}

/** The author, the gym's owner, or staff. */
export function canDeletePost(p: PostSubject, v: Viewer): boolean {
  if (p.deletedAt) return false;
  return isAuthor(p, v) || v.isGymOwner || v.isStaff;
}

/**
 * May this viewer COMMENT or REACT?
 *
 * Requires being signed in and being able to see it. Anything you can read you
 * can respond to — a post you can see but not answer is a broadcast, and the
 * visibility levels above are already the control over who sees what.
 */
export function canInteract(p: PostSubject, v: Viewer): boolean {
  return v.id !== null && canViewPost(p, v);
}

/** Same three rights on a comment, answered from the comment's own author. */
export function canEditComment(
  c: { authorId: string; deletedAt: Date | null },
  v: Viewer,
): boolean {
  return !c.deletedAt && v.id !== null && v.id === c.authorId;
}

export function canDeleteComment(
  c: { authorId: string; deletedAt: Date | null },
  v: Viewer,
): boolean {
  if (c.deletedAt) return false;
  return (v.id !== null && v.id === c.authorId) || v.isGymOwner || v.isStaff;
}

/**
 * May this viewer PUBLISH to this gym's feed?
 *
 * Two independent gates, and both are load-bearing:
 *
 *   1. `gymMayPublish` — the gym's own verification state (see
 *      lib/gyms/verification). An unclaimed or under-review gym publishes
 *      nothing, from anybody. That gate was built last sprint precisely so a
 *      stranger cannot publish to a business's page, and routing member posts
 *      around it would have quietly undone it.
 *
 *   2. the viewer is a MEMBER, the OWNER, or staff. This is what makes the
 *      feed a community rather than a broadcast channel: members of a verified
 *      gym post to their own gym's page. A signed-in stranger cannot.
 */
export function canCreatePost(v: Viewer, gymMayPublish: boolean): boolean {
  if (v.id === null) return false;
  // Staff bypass the state gate — support and moderation have to be able to act
  // on a page in any state — but never the identity check above.
  if (v.isStaff) return true;
  if (!gymMayPublish) return false;
  return v.isMember || v.isGymOwner;
}

/** Which visibilities this viewer may choose when posting to this gym. */
export function allowedVisibilities(v: Viewer): Visibility[] {
  if (v.id === null) return [];
  return ["PUBLIC", "MEMBERS", "PRIVATE"];
}
