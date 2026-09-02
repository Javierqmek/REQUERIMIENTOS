export function contentSecurityPolicy(nonce: string, supabaseUrl: string, production: boolean) {
  const url = new URL(supabaseUrl);
  const connect = [url.origin, url.origin.replace(/^http/, "ws")].join(" ");
  return [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", "frame-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
    `connect-src 'self' ${connect}${production ? "" : " ws://localhost:* ws://127.0.0.1:*"}`,
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];
