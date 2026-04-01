import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

const securityHeaders = [
  // Prevent embedding in iframes (clickjacking protection)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Prevent MIME type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Enforce HTTPS for 1 year (only applied over HTTPS)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Restrict referrer to same origin
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable unused browser features
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content Security Policy
  // Dev: allow unsafe-inline scripts for Next.js HMR/Turbopack; Production: self only
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
      isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.15'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
