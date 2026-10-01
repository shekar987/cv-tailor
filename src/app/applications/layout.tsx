import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. A plain
// string title would end the root template here, leaving the prep and
// interview pages without "· Jobhuntz" — hence default + template.
export const metadata: Metadata = {
  title: { default: "Applications", template: "%s · Jobhuntz" },
  robots: { index: false, follow: false },
  alternates: { canonical: "/applications" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
