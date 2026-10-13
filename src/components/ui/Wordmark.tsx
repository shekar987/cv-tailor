import Link from "next/link";

// The one wordmark: the J from the favicon (src/app/icon.svg), flat amber via
// currentColor, beside the name. Used by the app header, the auth cards, the
// 404 and error pages, the legal pages and the landing nav, so the mark is
// drawn in exactly one place.
export default function Wordmark({
  href = "/",
  className = "wordmark",
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={className} aria-label="Jobhuntz home">
      <svg className="wordmarkMark" viewBox="16 12 26 40" aria-hidden="true" focusable="false">
        <path
          d="M40 14 v26 a10 10 0 0 1 -10 10 h-2 a10 10 0 0 1 -10 -9 l7 -1.4 a4 4 0 0 0 3.6 3.4 h1.4 a3.5 3.5 0 0 0 3.5 -3.5 V14 Z"
          fill="currentColor"
        />
      </svg>
      <span>Jobhuntz</span>
    </Link>
  );
}
