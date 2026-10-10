import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * ESLint 9 flat configuration.
 *
 * Two typed projects, because the repo has two runtimes:
 *   - Browser/React code  -> tsconfig.json
 *   - Node/serverless code -> tsconfig.node.json
 * Type-aware rules only work when the file belongs to a project, so each
 * block points at its own tsconfig.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".vercel/**",
      "playwright-report/**",
      "test-results/**",
      "storybook-static/**",
    ],
  },

  // ------------------------------------------------------------------ browser
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // The game core is a deliberate exception to a few default opinions:
      // it is a stateful simulation, not a functional pipeline.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",

      // Quality gates we actually care about.
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // --------------------------------------------------------------------- node
  {
    files: ["api/**/*.ts", "db/**/*.ts", "server/**/*.ts", "scripts/**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.edge },
      parserOptions: {
        project: ["./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off", // server logs are legitimate in a serverless function
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // ------------------------------------------------------------- test files
  //
  // `expect(spy).toHaveBeenCalled()` references a method without calling it,
  // which `unbound-method` cannot distinguish from a genuine `this`-binding
  // bug. The rule is correct for production code and unhelpful in assertions.
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**/*.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },

  // ------------------------------------------------- quarantined legacy file
  //
  // `src/app/App.tsx` stores the mutable `Game` engine in `useState` and then
  // mutates it from effects (`game.paused = true`, `game.isTouch = …`, …).
  // That is incompatible with the React Compiler purity rules, and the fix is
  // architectural rather than cosmetic — it is task 4.1 on the board, which
  // replaces the direct engine coupling with a proper composition root.
  //
  // Until then these two rules are advisory *for that one file only*, so lint
  // stays green without hiding the debt. Every other file is held to the full
  // standard, and CI switches to `--max-warnings=0` once 4.1 lands.
  {
    files: ["src/app/App.tsx"],
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // ------------------------------------------------------------------- config
  {
    files: ["*.config.{ts,js}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "no-console": "off",
    },
  },
);
