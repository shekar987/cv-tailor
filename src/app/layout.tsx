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

const DESCRIPTION =
  "Honest CV tailoring. Every claim traces back to your real CV — nothing invented.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.jobhuntz.app"),
  title: {
    default: "Jobhuntz — honest CV tailoring",
    template: "%s · Jobhuntz",
  },
  description: DESCRIPTION,
  openGraph: {
    title: "Jobhuntz",
    description: DESCRIPTION,
    url: "/",
    siteName: "Jobhuntz",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jobhuntz",
    description: DESCRIPTION,
  },
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
