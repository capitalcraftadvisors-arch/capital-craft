/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // sharp + @google-cloud/storage contain native bindings — don't bundle them.
    serverComponentsExternalPackages: ['sharp', '@google-cloud/storage'],
    // Standalone build needs sharp's native binaries copied into the output.
    outputFileTracingIncludes: {
      '/api/upload': ['./node_modules/sharp/**/*'],
    },
  },
  // The Partner Portal's old loan-application pages were replaced by the chat
  // (/dashboard/apply/chat) — old links and bookmarks land there instead.
  async redirects() {
    return [
      { source: '/dashboard/new', destination: '/dashboard/apply/chat', permanent: false },
      { source: '/dashboard/apply', destination: '/dashboard/apply/chat', permanent: false },
      { source: '/dashboard/apply/:id/docs', destination: '/dashboard/apply/chat?id=:id&edit=1', permanent: false },
      { source: '/dashboard/apply/:id/loan', destination: '/dashboard/apply/chat?id=:id&edit=1', permanent: false },
    ];
  },
};

module.exports = nextConfig;
