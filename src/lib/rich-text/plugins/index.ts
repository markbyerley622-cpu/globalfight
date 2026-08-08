// ════════════════════════════════════════════════════════════════════════════
//  THE PLUGIN MANIFEST.
//
//  Every entity kind the product knows about, registered by importing it. This
//  file is the ONE place a new kind is listed, and it is deliberately nothing
//  but imports — no logic, no map, no switch. Adding a kind is a file plus a
//  line here; nothing that CONSUMES entities is touched.
//
//  ── Why a manifest rather than self-registration ──────────────────────────
//  ESM has no filesystem glob at runtime and Next's bundler will not include a
//  module nothing imports. A plugin that registered itself in a file nobody
//  imported would simply never run, and the symptom — entities of that kind
//  silently dropped by sanitizeEntities — is exactly the class of silent
//  failure this architecture removes. So the manifest is explicit, and
//  __tests__/registry-extensibility.test.ts fails if a plugin file is missing
//  from it, which turns "I forgot to register it" into a failing test instead
//  of a feature that quietly does not exist.
//
//  Import order is irrelevant: kinds are independent and `registerEntity`
//  throws on a genuine duplicate rather than letting one silently win.
// ════════════════════════════════════════════════════════════════════════════

import "./mention";
import "./fighter";
import "./event";
import "./gym";
import "./promotion";
