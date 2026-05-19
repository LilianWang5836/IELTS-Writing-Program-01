import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI IELTS Writing Tutor",
  description: "雅思写作硬核特训 — Stage 1-3 MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
