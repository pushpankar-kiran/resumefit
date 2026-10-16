import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATS Resume Analyzer",
  description: "Score a resume against a job description, find keyword gaps and parsing risks, and rewrite weak bullets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
