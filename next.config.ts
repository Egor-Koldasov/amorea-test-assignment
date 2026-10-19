import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: process.cwd() },
  devIndicators: false,
  agentRules: false,
};
export default config;
