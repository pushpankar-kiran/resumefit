/** @type {import('next').NextConfig} */

// Security headers for every response. The app is local-only (bound to 127.0.0.1), but pages
// still shouldn't be frameable, sniffable or able to load anything from other origins.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inlines its bootstrap scripts; no eval in production builds.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  // Parsers run server-side only; keep them out of the client bundle and let Node resolve them.
  serverExternalPackages: ["unpdf", "jszip", "nspell", "dictionary-en"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
