import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { OwnerTodo } from "../LegalShell";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What Jobhuntz stores about you, who processes it, and how to export or delete it.",
  alternates: { canonical: "/privacy" },
};

// Every statement below describes what the code does today (CLAUDE.md is the
// map). When a feature changes what is stored or who processes it, change
// this page in the same commit.
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy notice" updated="1 October 2026">
      <h2>Who runs Jobhuntz</h2>
      <p>
        Jobhuntz is built and run by Soma Shekar Keesari. It tailors your CV and cover letter to a job description, checks
        every claim in the result against your own CV, and keeps a tracker of your applications.
      </p>
      <OwnerTodo>state whether you operate as an individual or a company, your country or region, and the e-mail address people should use for privacy questions.</OwnerTodo>

      <h2>What we store</h2>
      <p>Everything below is kept in your account and only you can read it. Nothing is shared with other users.</p>
      <ul>
        <li>
          <strong>Your account.</strong> Your e-mail address and how you sign in (e-mail and password, Google or GitHub), handled by
          Supabase. We never see your password.
        </li>
        <li>
          <strong>Your master CV</strong> as you pasted or uploaded it, the profile extracted from it (name, contact details,
          education, projects), your eligibility answers (right to work, location, years, degree, availability), the claims
          registry (which skills you hold at production, project or learning level), your positioning variants, project links,
          document preferences and project pool.
        </li>
        <li>
          <strong>Your application tracker.</strong> For each row: company, role, dates, status, salary, your notes, the job description
          you pasted, the tailored CV and cover letter you saved with it, the CV file you uploaded as the one you sent, the
          interview prep pack, and the transcript and feedback of each mock interview. The mock interview stores text only:
          your voice is turned into text in your browser and <strong>no audio is sent or stored</strong>.
        </li>
        <li>
          <strong>Company research</strong> you request, cached in your account for seven days.
        </li>
        <li>
          <strong>Provider keys</strong> you add in Settings, encrypted (AES-256-GCM) before they are stored. Only a short hint is
          ever shown back. We never log a key.
        </li>
        <li>
          <strong>Usage counters</strong> (how many tailors you have run today and on the free credits) and any feedback you send
          through the feedback button. Feedback is write-only: it is not shown back to you and is not in the export.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Supabase</strong> hosts the database, sign-in and file storage.
          <OwnerTodo>name the Supabase project region (for example “EU West, Ireland”).</OwnerTodo>
        </li>
        <li>
          <strong>Vercel</strong> hosts the app. Its servers see your IP address and keep ordinary server logs.
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> receives the text of your CV, the job description and your eligibility answers when a run
          uses our free credits, so that it can write and check the result. Anthropic&apos;s API terms do not allow training on this
          data.
        </li>
        <li>
          <strong>OpenRouter or Google Gemini</strong> receive the same text only when you have added your own key in Settings and a run
          uses it. OpenRouter&apos;s free models may use what you send to train their models; the Settings page says so beside the key.
        </li>
        <li>
          <strong>Company research</strong> fetches the company&apos;s public website and job board from our server. Nothing about you is
          sent to the company.
        </li>
        <li>
          <strong>The mock interviewer&apos;s voice</strong> runs in your browser. Your browser downloads the voice model from Hugging Face
          and a library from jsDelivr; they see your IP address, never your text.
        </li>
        <li>
          <strong>Upstash</strong> (rate limiting), when configured, sees only your account id and a request count.
        </li>
      </ul>
      <p>We do not use analytics or advertising trackers. There is no third-party JavaScript on these pages.</p>

      <h2>Cookies and local storage</h2>
      <p>
        One or more session cookies keep you signed in. Your browser&apos;s local storage holds the run you are working on, your
        practice ratings and a game counter so a reload loses nothing; signing out or deleting your account clears them.
      </p>

      <h2>How long we keep it</h2>
      <p>Until you delete it. Deleting your account removes every row and file listed above at once.</p>
      <OwnerTodo>state how long server logs and database backups are retained (Vercel and Supabase defaults unless you have changed them).</OwnerTodo>

      <h2>Your rights and your controls</h2>
      <ul>
        <li>
          <strong>Export.</strong> Settings → Your data → Download everything gives you a JSON file of every table above except
          the write-only feedback.
        </li>
        <li>
          <strong>Delete.</strong> Settings → Your data → Delete my account removes your account, every row and every uploaded file,
          immediately and permanently.
        </li>
        <li>
          <strong>Correct.</strong> Everything is editable in the app: Customize for your CV and answers, the tracker for applications.
        </li>
      </ul>
      <p>
        If you are in the UK or the EU you also have the rights of access, rectification, erasure, portability, restriction and
        objection under data-protection law, and the right to complain to a supervisory authority (in the UK, the Information
        Commissioner&apos;s Office).
      </p>
      <OwnerTodo>confirm the governing data-protection law (UK GDPR is assumed) and the contact address for exercising these rights.</OwnerTodo>

      <h2>Changes</h2>
      <p>
        When a feature changes what is stored or who processes it, this page changes with it and the date at the top moves.
        See also the <Link href="/terms">terms of use</Link>.
      </p>
    </LegalShell>
  );
}
