/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // sharp + @google-cloud/storage contain native bindings — don't bundle them.
    serverComponentsExternalPackages: ['sharp', '@google-cloud/storage'],
  },
  // Standalone build needs sharp's native binaries copied into the output.
  outputFileTracingIncludes: {
    '/api/upload': ['./node_modules/sharp/**/*'],
  },
};

module.exports = nextConfig;
