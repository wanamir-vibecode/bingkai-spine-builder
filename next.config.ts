import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Gemini SDK and ffmpeg helpers only ever run on the server.
  serverExternalPackages: ["@google/genai"],
};

export default nextConfig;
