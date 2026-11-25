import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Behind
// sign-in, so never indexed.
export const metadata: Metadata = {
  title: "Auto-apply",
  robots: { index: false, follow: false },
  alternates: { canonical: "/agent" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
