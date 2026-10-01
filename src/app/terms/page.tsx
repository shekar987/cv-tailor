import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { OwnerTodo } from "../LegalShell";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "What Jobhuntz does, what it will not do, and what you agree to when you use it.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of use" updated="1 October 2026">
      <h2>What Jobhuntz does</h2>
      <p>
        You give it your CV and a job description. It writes a tailored CV and cover letter from what your CV already says,
        scores how visible the result is to a recruiter searching for the role&apos;s terms, keeps a tracker of your
        applications, and prepares you for interviews. Every figure, skill and sentence in the result is checked against your
        CV before you see it, and anything it cannot trace is removed or marked.
      </p>

      <h2>What it will not do</h2>
      <p>
        It will not invent experience, skills, figures or dates for you, and it is built so that it cannot be made to. If a job
        asks for something your CV does not show, the result says so instead of pretending.
      </p>

      <h2>Your responsibility</h2>
      <p>
        The result is a draft of <em>your</em> application. Read every line before you send it. The checks catch what a model
        gets wrong far more often than not, but they are not perfect, and the CV you send carries your name. You confirm that
        what you put into Jobhuntz is true and is yours to use; do not upload another person&apos;s CV without their permission.
      </p>

      <h2>Your account and fair use</h2>
      <ul>
        <li>One account per person. Keep your sign-in to yourself.</li>
        <li>
          Three tailors a day, the first three ever on our credits; after that a free key of your own (Settings) keeps you going
          at no cost. The daily cap applies on every path.
        </li>
        <li>Use the app through its pages, not through scripts against its API, and do not try to get around the limits.</li>
        <li>No unlawful content, and nothing meant to deceive an employer about who you are or what you have done.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your CV, your answers, your applications and everything generated from them are yours. We use them only to run the
        service for you, as the <Link href="/privacy">privacy notice</Link> describes. When a run sends your text to an AI
        provider, that provider&apos;s terms apply to the processing; the privacy notice names them.
      </p>

      <h2>The service as provided</h2>
      <p>
        Jobhuntz is provided free and as it is. It may be unavailable, change or stop; a run may fail; a provider may run out
        of capacity. It does not promise an interview or a job, and it is not legal, immigration or career advice. To the extent
        the law allows, we are not liable for loss arising from your use of it, including the outcome of any application.
      </p>
      <OwnerTodo>have the liability wording and the governing law reviewed. England and Wales is assumed as the governing law and forum.</OwnerTodo>

      <h2>Ending things</h2>
      <p>
        You can delete your account at any time from Settings; everything goes with it. We may suspend an account that breaks
        these terms, and we will tell you why.
      </p>

      <h2>Changes and contact</h2>
      <p>If these terms change, the date at the top moves and the change is described here.</p>
      <OwnerTodo>give the contact e-mail address for questions about these terms.</OwnerTodo>
    </LegalShell>
  );
}
