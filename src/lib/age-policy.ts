// Minimum age to hold an account.
//
// This is an ACKNOWLEDGEMENT, not verification. An age gate is not proof of age and
// we do not present it as one — see /responsible-gambling. We ask the least intrusive
// question that answers what we need to know ("are you old enough?"), rather than
// collecting a full date of birth we have no other use for.
export const MINIMUM_AGE = 16;

/** Bump when the wording changes, so we know what each user actually agreed to. */
export const AGE_POLICY_VERSION = "2026-07-13";

export const AGE_STATEMENT =
  `I confirm I am at least ${MINIMUM_AGE} years old.`;
