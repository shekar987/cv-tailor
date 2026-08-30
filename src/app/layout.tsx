import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import FeedbackWidget from "./FeedbackWidget";

// Exposed as --font-geist-sans and consumed by --font-sans in globals.css.
// (Geist Mono was loaded too but nothing in the app uses a monospace face.)
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jobhuntz",
  description: "Honest, ATS-ready CV tailoring. Every claim traces back to your real CV — nothing invented.",
};

export const viewport: Viewport = {
  themeColor: "#0E0E10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body>
        {children}
        <FeedbackWidget />
      </body>
    </html>
  );
}
