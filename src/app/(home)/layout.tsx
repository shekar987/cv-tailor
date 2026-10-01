import type { Metadata } from "next";

// The landing page is a client component, so its canonical lives here. A
// route group: the URL stays "/". The root layout sets no canonical, so the
// 404, the error boundary and the auth error page never claim to be the home.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
