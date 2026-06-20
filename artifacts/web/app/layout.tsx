import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdOps Intelligence",
  description: "Advengers Worldwide — AdOps Intelligence Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
