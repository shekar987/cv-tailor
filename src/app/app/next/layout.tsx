import type { Metadata } from "next";

// The page itself is a client component, so its title lives here.
export const metadata: Metadata = {
  title: "What's next",
  robots: { index: false, follow: false },
  alternates: { canonical: "/app/next" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
