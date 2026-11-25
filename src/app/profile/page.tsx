"use client";

// "Your profile facts" — the structured master profile (TL-2). Each bullet and
// metric carries a source tracing it to a line of the main CV; this page lets
// the owner read and correct it. Save runs the same deterministic validation as
// the importer and blocks on any problem (an invented number, a production
// skill with no bullet, RideX mislabelled, a missing source).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getStructuredProfile,
  saveStructuredProfile,
  getMasterCV,
} from "@/lib/cvStore";
import { buildStructuredProfile } from "@/lib/profile/import";
import { validateStructuredProfile } from "@/lib/profile/validate";
import { type StructuredProfile } from "@/lib/profile/schema";
import AppHeader from "@/components/ui/AppHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ProfileEditor, { type SaveState } from "./ProfileEditor";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StructuredProfile | null>(null);
  const [masterCv, setMasterCv] = useState<string>("");
  const [hasCv, setHasCv] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [sp, cv] = await Promise.all([getStructuredProfile(), getMasterCV()]);
      if (!active) return;
      setProfile(sp);
      setMasterCv(cv?.text ?? "");
      setHasCv(Boolean(cv?.text?.trim()));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Mutating helper: produce a new profile, reset the saved flag.
  function update(next: StructuredProfile) {
    setProfile(next);
    setSaveState("idle");
  }

  const liveProblems = useMemo(
    () => (profile ? validateStructuredProfile(profile, masterCv).problems : []),
    [profile, masterCv]
  );

  async function handleBuildFromCv() {
    if (!hasCv) return;
    setBuilding(true);
    const { profile: built } = buildStructuredProfile(masterCv, new Date().toISOString());
    setProfile(built);
    setProblems([]);
    setSaveState("idle");
    setBuilding(false);
  }

  async function handleSave() {
    if (!profile) return;
    const result = validateStructuredProfile(profile, masterCv);
    setProblems(result.problems);
    if (!result.ok) {
      setSaveState("idle");
      return;
    }
    setSaveState("saving");
    const ok = await saveStructuredProfile(profile);
    setSaveState(ok ? "saved" : "idle");
    if (!ok) setProblems(["We couldn't save your profile facts. Please check you are signed in and try again."]);
  }

  return (
    <main className="page">
      <div className="container container--narrow">
        <AppHeader
          title="Your profile facts"
          tagline="The facts behind every tailored CV. Each number traces back to a line of your main CV."
        />

        <div className="profileFactsHead">
          <p className="cvHelp">
            This is your main CV turned into data: your roles, bullets, numbers, skills and projects.
            Every tailored CV is built only from what is here, and every number must appear in your{" "}
            <Link href="/customize" className="inlineLink">main CV</Link> exactly as written. Fix anything that is wrong,
            then Save.
          </p>
          <Button href="/customize" variant="secondary">← Back to My CV</Button>
        </div>

        {loading ? (
          <Card><Skeleton lines={5} label="Loading your profile facts" /></Card>
        ) : !profile ? (
          <Card>
            <EmptyState
              title="No profile facts yet"
              actions={
                hasCv ? (
                  <Button onClick={handleBuildFromCv} disabled={building} data-build-profile>
                    {building ? "Reading your CV…" : "Build from my main CV"}
                  </Button>
                ) : (
                  <Button href="/customize">Add your main CV first</Button>
                )
              }
            >
              {hasCv
                ? "Build the structured facts from your saved main CV. Nothing is sent to an AI — it is read by rules. You can then check and correct every line here."
                : "Save your main CV on the My CV page first, then come back to build your profile facts."}
            </EmptyState>
          </Card>
        ) : (
          <ProfileEditor
            profile={profile}
            masterCv={masterCv}
            showSources={showSources}
            onToggleSources={() => setShowSources((s) => !s)}
            onChange={update}
            onRebuild={hasCv ? handleBuildFromCv : undefined}
            building={building}
            liveProblems={liveProblems}
            problems={problems}
            saveState={saveState}
            onSave={handleSave}
          />
        )}
      </div>
    </main>
  );
}

