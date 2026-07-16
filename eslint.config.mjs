// Minimal, framework-appropriate ESLint config.
//
// The repository previously had NO lint configuration at all — `next lint` only ever
// offered to create one. This is the smallest setup that actually runs and understands
// this codebase (Next app router, React hooks, Node scripts). It is deliberately not a
// style opinion: it exists to catch mistakes, not to trigger a mass reformat.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      ".next/**", "node_modules/**", "prisma/migrations/**", "prisma/phase2/**",
      "licenses/**", "public/**", "*.config.*", "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      // react-hooks' newer compiler rules fire on a lot of PRE-EXISTING components
      // (setState-in-effect, components-created-in-render). They are worth knowing about,
      // but fixing them is a refactor of code unrelated to this compliance work, so they
      // are warnings, not errors. Do not silence them — they are real.
      ...Object.fromEntries(
        Object.entries(reactHooks.configs.recommended.rules ?? {}).map(([k]) => [k, "warn"]),
      ),

      // Leftovers from a half-finished edit — worth knowing about, not worth blocking on.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The provider seams legitimately use `any` where a third-party shape is unknown.
      "@typescript-eslint/no-explicit-any": "warn",
      // JSX conditional rendering (`{cond && <X/>}`) reads as an unused expression.
      "@typescript-eslint/no-unused-expressions": "off",
      "no-unused-expressions": "off",
      "no-useless-assignment": "off",
      "no-console": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
