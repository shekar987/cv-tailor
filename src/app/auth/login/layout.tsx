import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. Sign-in
// is the one gated page a search engine may list.
export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/auth/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
