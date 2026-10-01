import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Behind
// sign-in, so never indexed; the canonical is its own path (or none for a
// per-application page).
export const metadata: Metadata = {
  title: "Tailor",
  robots: { index: false, follow: false },
  alternates: { canonical: "/app" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
