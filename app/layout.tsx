import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "톤즈의원 번역기",
  description: "용어집 기반 의료 원고 번역",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
