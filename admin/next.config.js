// Security headers on every response (pages, API routes, files).
//   - nosniff: the browser trusts our Content-Type (every file route sets one).
//   - Referrer: other sites see only our origin, never a full URL (tokens in
//     /p/<token>, /api/f/<token> stay private).
//   - Framing: only our own pages may put us in a frame (the document viewer
//     shows signed storage links, which are other sites — not affected).
//     X-Frame-Options for old browsers, frame-ancestors for new ones; this is
//     the ONLY CSP directive on purpose (no full CSP).
//   - HSTS: HTTPS only, for two years (browsers ignore it on http://localhost).
//   - Permissions: camera + location for our own pages (GeoOfficeUpload's live
//     photo, GPS on rooftop / office photos); no microphone, payment or USB.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
];

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
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
