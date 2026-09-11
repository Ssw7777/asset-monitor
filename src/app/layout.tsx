import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0xStudy Checker",
  description: "Security-first crypto portfolio monitor",
  icons: { icon: "/avatar.jpg", apple: "/avatar.jpg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body className="antialiased">{children}</body>
    </html>
  );
}
