import type { Metadata } from "next";

// The page itself is a client component, so its title lives here.
export const metadata: Metadata = {
  title: { absolute: "Action Centre · Jobhuntz" },
  robots: { index: false, follow: false },
  alternates: { canonical: "/app/actions" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
