import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

export default tseslint.config(
  {
    ignores: [
      ".claude/**",
      ".agents/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.check.json",
        tsconfigRootDir,
      },
    },
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Tools must be invoked through test/mcpToolHarness.ts, which parses input the way a
    // client's request is parsed. Calling a handler with an object literal asserts nothing about
    // the surface: handlers destructure whatever they are given, so the test passes unchanged
    // when the field is deleted from the schema, and Zod strips undeclared keys. That gap hid a
    // routing flag being unreachable on two consecutive PRs.
    //
    // A rule rather than a convention, because this repository has twice watched a fix's own
    // coverage turn out narrower than the thing it covered — test/db/schemaLeakGuard.ts exists
    // for the same reason. Converting the call sites fixed the instances; this is what stops the
    // next one being written.
    //
    // Two files are exempt, and neither exemption is a judgement that the rule does not apply:
    // mcpToolHarness.ts is the harness itself, and serverRequestLogging.test.ts parses through
    // an equivalent local helper while its thirteen call sites await conversion (T-56). Naming
    // that here rather than letting the rule's wording imply an enforcement it does not yet
    // have — an overstated guard is how this repository has been misled before.
    files: ["test/**/*.ts"],
    ignores: ["test/mcpToolHarness.ts", "test/serverRequestLogging.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Both access forms. `name` matches `tool.handler(...)`; `value` matches
          // `tool["handler"](...)`, which bypasses the schema exactly as readily and which the
          // dot form alone does not see. A rule that names one and claims both is the defect
          // this whole change is about, one level up.
          selector:
            "CallExpression[callee.property.name='handler'], CallExpression[callee.property.value='handler']",
          message:
            "Invoke MCP tools through callTool from test/mcpToolHarness.ts, which parses input " +
            "through the registered schema. Calling .handler directly bypasses the surface.",
        },
      ],
    },
  },
  {
    files: ["src/ui/assets.ts"],
    rules: {
      "no-useless-escape": "off",
    },
  },
);
