/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Runs instrumentation.ts once at server boot (development scheduler only).
    instrumentationHook: true,
  },
};
export default nextConfig;
