import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: process.env.BASE_PATH ?? "",
  serverExternalPackages: ["@libsql/client", "knex", "pg", "mysql2", "mssql"],
  allowedDevOrigins: ["10.0.9.15"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH ?? "",
  },
};

export default nextConfig;
