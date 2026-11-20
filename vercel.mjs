/** Generate a same-origin proxy so login cookies work without third-party cookies. */
/** @param {Record<string, string | undefined>} env */
export function createVercelConfig(env = process.env) {
  if (env.VERCEL && !env.API_ORIGIN) {
    throw new Error(
      "Set API_ORIGIN to the HTTPS Render backend origin before deploying.",
    );
  }
  const value = env.API_ORIGIN ?? "http://127.0.0.1:3000";
  const target = new URL(value);
  if (
    target.origin !== value ||
    target.username ||
    target.password ||
    !["http:", "https:"].includes(target.protocol) ||
    (env.VERCEL && target.protocol !== "https:")
  )
    throw new Error(
      "API_ORIGIN must be a bare HTTPS origin, without credentials, path, query or trailing slash.",
    );

  return {
    framework: "vite",
    installCommand: "npm ci --include=dev",
    buildCommand: "npm run build",
    outputDirectory: "dist",
    rewrites: [
      { source: "/api/:path*", destination: `${target.origin}/api/:path*` },
      { source: "/((?!api(?:/|$)).*)", destination: "/index.html" },
    ],
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ],
  };
}

export const config = createVercelConfig();
