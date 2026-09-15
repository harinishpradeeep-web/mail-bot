/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module: keep it out of the bundler.
  serverExternalPackages: undefined,
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    // Runs instrumentation.ts once at server boot (development scheduler only).
    instrumentationHook: true,
  },
};
export default nextConfig;
