/** @type {import('next').NextConfig} */
const nextConfig = {
  // Parsers run server-side only; keep them out of the client bundle and let Node resolve them.
  serverExternalPackages: ["unpdf", "mammoth", "jszip", "nspell", "dictionary-en"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};
export default nextConfig;
