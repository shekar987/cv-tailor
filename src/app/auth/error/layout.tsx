import type { Metadata } from "next";

// An error landing, never indexed and never the canonical of anything.
export const metadata: Metadata = {
  title: "Sign-in problem",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
