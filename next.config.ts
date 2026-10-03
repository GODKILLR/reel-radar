import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Instagram CDN thumbnails. Apify returns signed fbcdn/cdninstagram URLs.
    remotePatterns: [
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
    ],
  },
};

export default nextConfig;
