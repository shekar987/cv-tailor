import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Behind
// sign-in, so never indexed.
export const metadata: Metadata = {
  title: "Interviews",
  robots: { index: false, follow: false },
  alternates: { canonical: "/interviews" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
