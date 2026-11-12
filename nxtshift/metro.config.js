const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Keep server-only code (Edge Functions, DB tests, operator scripts) out of the app bundle.
const escape = (p) => p.replace(/[/\\^$*+?.()|[\]{}-]/g, "\\$&");
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(__dirname, "supabase"))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(__dirname, "scripts"))}[/\\\\].*`),
];

module.exports = withNativeWind(config, { input: "./global.css" });
