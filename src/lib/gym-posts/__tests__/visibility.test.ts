// Access-control tests. Pure — every combination, no fixtures, no database.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canViewPost, canEditPost, canDeletePost, canInteract,
  canCreatePost, canEditComment, canDeleteComment, ANONYMOUS,
  type PostSubject, type Viewer,
} from "../visibility";
import type { Visibility } from "../types";

const AUTHOR = "user-author";
const OWNER = "user-owner";
const MEMBER = "user-member";
const STRANGER = "user-stranger";
const STAFF = "user-staff";

const subject = (visibility: Visibility, deletedAt: Date | null = null): PostSubject => ({
  authorId: AUTHOR,
  gymId: "gym-1",
  visibility,
  deletedAt,
});

const VIEWERS: Record<string, Viewer> = {
  anonymous: ANONYMOUS,
  author: { id: AUTHOR, isStaff: false, isMember: true, isGymOwner: false },
  owner: { id: OWNER, isStaff: false, isMember: false, isGymOwner: true },
  member: { id: MEMBER, isStaff: false, isMember: true, isGymOwner: false },
  stranger: { id: STRANGER, isStaff: false, isMember: false, isGymOwner: false },
  staff: { id: STAFF, isStaff: true, isMember: false, isGymOwner: false },
};

describe("reading a post", () => {
  // The full matrix, spelled out. This is the table the API's behaviour has to
  // match, and writing it as data means adding a visibility level cannot
  // silently leave a combination unconsidered.
  const EXPECTED: Record<Visibility, Record<keyof typeof VIEWERS, boolean>> = {
    PUBLIC:  { anonymous: true,  author: true, owner: true, member: true,  stranger: true,  staff: true },
    MEMBERS: { anonymous: false, author: true, owner: true, member: true,  stranger: false, staff: true },
    PRIVATE: { anonymous: false, author: true, owner: true, member: false, stranger: false, staff: true },
  };

  for (const [visibility, row] of Object.entries(EXPECTED) as [Visibility, Record<string, boolean>][]) {
    for (const [who, allowed] of Object.entries(row)) {
      it(`${visibility}: ${who} ${allowed ? "may" : "may not"} read`, () => {
        assert.equal(canViewPost(subject(visibility), VIEWERS[who]), allowed);
      });
    }
  }

  it("hides a deleted post from EVERYONE, including its author and staff", () => {
    // Moderators review removed content through the console, which reads the
    // row directly and logs that it did. A read path that quietly resurrects
    // deleted content for privileged callers is how "deleted" stops meaning
    // anything.
    const gone = subject("PUBLIC", new Date());
    for (const viewer of Object.values(VIEWERS)) {
      assert.equal(canViewPost(gone, viewer), false);
    }
  });

  it("fails CLOSED on a visibility it does not recognise", () => {
    // A value written by a newer deploy during a rollout. Defaulting to PUBLIC
    // would publish it.
    const future = { ...subject("PUBLIC"), visibility: "FRIENDS_OF_FRIENDS" as Visibility };
    assert.equal(canViewPost(future, VIEWERS.stranger), false);
    assert.equal(canViewPost(future, VIEWERS.member), false);
  });
});

describe("editing is not the same right as deleting", () => {
  it("lets ONLY the author edit", () => {
    const p = subject("PUBLIC");
    assert.equal(canEditPost(p, VIEWERS.author), true);
    // The gym's owner and a moderator may remove someone's post. Neither may
    // rewrite it — that would be putting words in another person's mouth, under
    // their name and their face.
    assert.equal(canEditPost(p, VIEWERS.owner), false);
    assert.equal(canEditPost(p, VIEWERS.staff), false);
    assert.equal(canEditPost(p, VIEWERS.member), false);
    assert.equal(canEditPost(p, VIEWERS.anonymous), false);
  });

  it("lets the author, the gym's owner and staff delete", () => {
    const p = subject("PUBLIC");
    assert.equal(canDeletePost(p, VIEWERS.author), true);
    assert.equal(canDeletePost(p, VIEWERS.owner), true);
    assert.equal(canDeletePost(p, VIEWERS.staff), true);
    assert.equal(canDeletePost(p, VIEWERS.member), false);
    assert.equal(canDeletePost(p, VIEWERS.stranger), false);
    assert.equal(canDeletePost(p, VIEWERS.anonymous), false);
  });

  it("refuses both on an already-deleted post", () => {
    const gone = subject("PUBLIC", new Date());
    assert.equal(canEditPost(gone, VIEWERS.author), false);
    assert.equal(canDeletePost(gone, VIEWERS.staff), false);
  });
});

describe("interacting", () => {
  it("requires being signed in AND being able to read it", () => {
    assert.equal(canInteract(subject("PUBLIC"), VIEWERS.anonymous), false);
    assert.equal(canInteract(subject("PUBLIC"), VIEWERS.stranger), true);
    assert.equal(canInteract(subject("MEMBERS"), VIEWERS.stranger), false);
    assert.equal(canInteract(subject("MEMBERS"), VIEWERS.member), true);
  });
});

describe("comments", () => {
  const comment = (authorId: string, deletedAt: Date | null = null) => ({ authorId, deletedAt });

  it("follows the same author/moderator split as posts", () => {
    assert.equal(canEditComment(comment(MEMBER), VIEWERS.member), true);
    assert.equal(canEditComment(comment(MEMBER), VIEWERS.owner), false);
    assert.equal(canEditComment(comment(MEMBER), VIEWERS.staff), false);

    assert.equal(canDeleteComment(comment(MEMBER), VIEWERS.member), true);
    assert.equal(canDeleteComment(comment(MEMBER), VIEWERS.owner), true);
    assert.equal(canDeleteComment(comment(MEMBER), VIEWERS.staff), true);
    assert.equal(canDeleteComment(comment(MEMBER), VIEWERS.stranger), false);
  });

  it("refuses to act on one already removed", () => {
    assert.equal(canEditComment(comment(MEMBER, new Date()), VIEWERS.member), false);
    assert.equal(canDeleteComment(comment(MEMBER, new Date()), VIEWERS.staff), false);
  });
});

describe("publishing to a gym's feed", () => {
  it("refuses everyone while the gym is not verified", () => {
    // The gate built last sprint: an unclaimed or under-review gym publishes
    // nothing, from anybody. Letting members route around it would have quietly
    // undone the whole point of gym verification.
    for (const who of ["author", "owner", "member", "stranger"] as const) {
      assert.equal(canCreatePost(VIEWERS[who], false), false, `${who} must be refused`);
    }
  });

  it("lets staff act on a gym in any state", () => {
    // Support and moderation have to be able to work on an unverified page.
    assert.equal(canCreatePost(VIEWERS.staff, false), true);
  });

  it("on a verified gym, admits members and the owner but not a stranger", () => {
    assert.equal(canCreatePost(VIEWERS.member, true), true);
    assert.equal(canCreatePost(VIEWERS.owner, true), true);
    assert.equal(canCreatePost(VIEWERS.author, true), true);
    assert.equal(canCreatePost(VIEWERS.stranger, true), false);
  });

  it("never admits an anonymous caller, whatever the gym's state", () => {
    assert.equal(canCreatePost(ANONYMOUS, true), false);
    assert.equal(canCreatePost(ANONYMOUS, false), false);
  });
});

describe("authorization never consults the media", () => {
  it("has no way to be told who uploaded an attachment", () => {
    // Not a behavioural assertion — a STRUCTURAL one. PostSubject carries the
    // author, the gym and the visibility, and nothing about an asset. Assets are
    // deduplicated, so ownerId records whoever uploaded a given file FIRST;
    // deriving any right from it would hand the first uploader of a common image
    // power over every later post that attaches it.
    const keys = Object.keys(subject("PUBLIC"));
    assert.deepEqual(keys.sort(), ["authorId", "deletedAt", "gymId", "visibility"]);
    for (const key of keys) {
      assert.ok(!/asset|media|upload/i.test(key), `${key} must not describe media`);
    }
  });
});
