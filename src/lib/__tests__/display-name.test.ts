import { test } from "node:test";
import assert from "node:assert/strict";
import { publicDisplayName, isPublishableName, initialsFor } from "@/lib/display-name";

// This is a PRIVACY control, not a formatting helper: a regression here republishes
// a real user's email address on a share card, in a page title and in the meta
// description a group chat renders. So the email cases are pinned hard.

test("a normal name is used as-is", () => {
  assert.equal(publicDisplayName({ name: "Mark Byerley", username: "markb" }), "Mark Byerley");
});

test("an email as the name falls back to the handle — the live leak", () => {
  // The exact value that shipped: browsers autofill autocomplete="username" with
  // the account email, and the field storing `name` used that token.
  assert.equal(
    publicDisplayName({ name: "markbyerley6221@gmail.com", username: "markbyerley6221gmail" }),
    "@markbyerley6221gmail",
  );
});

test("email-shaped values are caught even when they are not valid emails", () => {
  // The question is "would a human read this as an email?", not "is it deliverable?".
  for (const bad of ["a@b", "a@b.", "  x@y.z  ", "name@domain", "MARK@GMAIL.COM"]) {
    assert.equal(publicDisplayName({ name: bad, username: "handle" }), "@handle", bad);
  }
});

test("a name containing an email anywhere is refused", () => {
  assert.equal(
    publicDisplayName({ name: "Mark (mark@x.com)", username: "handle" }),
    "@handle",
    "an embedded address still leaks",
  );
});

test("an @ with spaces around it is a legitimate name, not an address", () => {
  // \S+@\S+ requires non-space on BOTH sides, so a stage name survives. The rule is
  // conservative about addresses without being so blunt that it eats real names.
  assert.equal(publicDisplayName({ name: "DJ @ Large", username: "h" }), "DJ @ Large");
  assert.equal(isPublishableName("DJ @ Large"), true);
});

test("no name falls back to the handle", () => {
  assert.equal(publicDisplayName({ name: null, username: "ada" }), "@ada");
  assert.equal(publicDisplayName({ name: "   ", username: "ada" }), "@ada");
});

test("no name and no handle never renders blank or an id", () => {
  assert.equal(publicDisplayName({ name: null, username: null }), "A predictor");
  assert.equal(publicDisplayName(null), "A predictor");
  assert.equal(publicDisplayName(undefined), "A predictor");
});

test("isPublishableName gates the signup form", () => {
  assert.equal(isPublishableName("Mark Byerley"), true);
  assert.equal(isPublishableName("markbyerley6221@gmail.com"), false);
  assert.equal(isPublishableName(""), false);
  assert.equal(isPublishableName("   "), false);
  assert.equal(isPublishableName(null), false);
});

// ── initials ────────────────────────────────────────────────────────────────

test("initials come from the PUBLIC name, never the raw record", () => {
  // The live card rendered "1g" — the tail of the email — as this user's initials.
  assert.equal(initialsFor({ name: "markbyerley6221@gmail.com", username: "markbyerley6221gmail" }), "MA");
  assert.equal(initialsFor({ name: "Mark Byerley", username: "markb" }), "MB");
});

test("initials handle one-word names, separators and empties", () => {
  assert.equal(initialsFor({ name: "Ada", username: "a" }), "AD");
  assert.equal(initialsFor({ name: "ada.lovelace", username: "a" }), "AL");
  assert.equal(initialsFor({ name: "ada_lovelace", username: "a" }), "AL");
  assert.equal(initialsFor({ name: null, username: "ada" }), "AD");
  assert.equal(initialsFor(null), "AP", "the placeholder still yields something to draw");
});
