import type { Metadata } from "next";

// Client page, so its title lives here. Behind sign-in, so never indexed; the
// canonical is its own path.
export const metadata: Metadata = {
  title: "Your profile facts",
  robots: { index: false, follow: false },
  alternates: { canonical: "/profile" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
