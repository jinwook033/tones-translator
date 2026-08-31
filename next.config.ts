import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  // native Node.js addon — webpack/turbopack이 번들링하면 안 됨
  // playwright/playwright-core: VPS에는 미설치 (맥 스튜디오만 사용) — external로 빌드 통과
  serverExternalPackages: ["node-libcurl-ja3", "playwright", "playwright-core"],
  turbopack: {
    root: resolve(__dirname),
  },
  headers: async () => [
    {
      // HTML 페이지는 항상 서버에서 최신 버전 확인
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
  ],
};

export default nextConfig;
