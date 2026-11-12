// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "supabase/*", "scripts/*", "node_modules/*"],
  },
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // TypeScript already validates namespace members (and follows `export *`).
      "import/namespace": "off",
    },
  },
]);
