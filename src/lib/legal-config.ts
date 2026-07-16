// ════════════════════════════════════════════════════════════════════════
//  Legal identity — supplied by the OPERATOR, never invented here.
//
//  A privacy notice must name the controller: who they are, where they are, how to
//  contact them, and which law applies. I do not know any of those things, and
//  making them up would be worse than leaving them blank — a policy naming a company
//  that does not exist is not a policy, it is a misrepresentation.
//
//  So: these come from the environment, and in PUBLIC_LAUNCH_MODE the production
//  preflight FAILS if any are missing or still a placeholder. The pages render an
//  explicit "not configured" marker in development so the gap is visible rather than
//  papered over.
// ════════════════════════════════════════════════════════════════════════

export const LEGAL_FIELDS = [
  "LEGAL_ENTITY_NAME",
  "LEGAL_ENTITY_ADDRESS",
  "LEGAL_CONTACT_EMAIL",
  "PRIVACY_CONTACT_EMAIL",
  "COPYRIGHT_CONTACT_EMAIL",
  "LEGAL_JURISDICTION",
  "POLICY_EFFECTIVE_DATE",
] as const;

export type LegalField = (typeof LEGAL_FIELDS)[number];

/** Values that mean "not filled in". */
const PLACEHOLDERS = [
  "", "tbd", "todo", "change-me", "changeme", "your company", "your-company",
  "example", "acme", "n/a", "placeholder", "company name", "unknown",
];

export function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDERS.includes(value.trim().toLowerCase());
}

export interface LegalIdentity {
  entityName: string;
  entityAddress: string;
  legalEmail: string;
  privacyEmail: string;
  copyrightEmail: string;
  jurisdiction: string;
  effectiveDate: string;
  /** True when every field is really supplied. */
  configured: boolean;
}

const NOT_SET = "[NOT CONFIGURED — operator must set this before public launch]";

export function legalIdentity(env: NodeJS.ProcessEnv = process.env): LegalIdentity {
  const get = (k: LegalField) => (isPlaceholder(env[k]) ? NOT_SET : (env[k] as string));

  const identity = {
    entityName: get("LEGAL_ENTITY_NAME"),
    entityAddress: get("LEGAL_ENTITY_ADDRESS"),
    legalEmail: get("LEGAL_CONTACT_EMAIL"),
    privacyEmail: get("PRIVACY_CONTACT_EMAIL"),
    copyrightEmail: get("COPYRIGHT_CONTACT_EMAIL"),
    jurisdiction: get("LEGAL_JURISDICTION"),
    effectiveDate: get("POLICY_EFFECTIVE_DATE"),
  };

  return {
    ...identity,
    configured: !Object.values(identity).includes(NOT_SET),
  };
}

/** Which legal fields are missing. Used by the production preflight. */
export function missingLegalFields(env: NodeJS.ProcessEnv = process.env): LegalField[] {
  return LEGAL_FIELDS.filter((f) => isPlaceholder(env[f]));
}
