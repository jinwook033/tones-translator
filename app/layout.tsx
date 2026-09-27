import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "톤즈 번역 콘솔",
  description: "용어집 기반 의료 원고 번역 · 검수",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 언어별 글꼴 — 한 글꼴로 4개 언어를 찍으면 한자 모양이 언어별 관례와 어긋난다 */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+TC:wght@400;500;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
