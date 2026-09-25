"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getMasterCV,
  saveMasterCV,
  clearMasterCV,
  saveProjectsPool,
  getUserSettings,
  saveEligibility,
  saveClaims,
  saveVariants,
  savePreferences,
  getProfile,
  saveProfile,
  clearProfile,
  importFromLocalStorageIfNeeded,
  type Profile,
} from "@/lib/cvStore";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import { MAX_CV_CHARS, MAX_POOL_CHARS } from "@/lib/limits";
import {
  EMPTY_ELIGIBILITY,
  normalizeEligibility,
  isEligibilitySet,
  type Eligibility,
  type EmploymentType,
} from "@/lib/knockouts";
import {
  normalizeClaims,
  normalizeSkillGuesses,
  seedClaimsFromCv,
  mergeClaims,
  extractFigures,
  cvFingerprint,
  countUnconfirmed,
  type ClaimsRegistry,
  type ClaimLevel,
} from "@/lib/claims";

const NEXT_LEVEL: Record<ClaimLevel, ClaimLevel> = { production: "project", project: "learning", learning: "production" };

import { splitTrailingDate } from "@/lib/projectDate";
import { stripMarkdown } from "@/lib/markdownText";
import { extractionFlags, mergeProfileEdits } from "@/lib/extractionCheck";
import {
  normalizeVariants,
  newVariantId,
  ROLE_TYPES,
  ROLE_TYPE_LABEL,
  MAX_VARIANTS,
  type VariantsConfig,
  type Variant,
  type RoleType,
  productionLeadSkills,
  leadSkillsNotice,
} from "@/lib/variants";
import { normalizePreferences, DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import CvUpload from "../CvUpload";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";
import SectionHeading from "@/components/ui/SectionHeading";
import CollapsibleSection from "@/components/ui/CollapsibleSection";
import Icon, { type IconName } from "@/components/ui/Icon";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
  resolveSectionOrder,
  isDefaultOrder,
  type SectionId,
} from "@/lib/sectionOrder";

// The nine questions the Eligibility card asks. Counted for the section's
// summary line so an unanswered profile is visible without opening it —
// collapsing a section must never hide that something still needs doing.
const ELIGIBILITY_QUESTIONS = 9;
const rtwBannerKey = (userId: string) => `jobhuntz:rtw-full-banner:${userId}`;

function eligibilityAnswered(e: Eligibility): number {
  let n = 0;
  if (e.rightToWork.status !== "unknown") n++;
  if (e.clearance.held !== "unknown") n++;
  if (e.yearsExperience !== null) n++;
  if (e.location.base.length > 0) n++;
  if (e.location.onsiteOk !== null) n++;
  if (e.location.hybridOk !== null) n++;
  if (e.degree.level !== "unknown") n++;
  if (e.licences.length > 0) n++;
  if (e.employmentTypes.length > 0) n++;
  return n;
}

// The section nav. Ids match the section elements; `always` marks the two
// that are never collapsed, so clicking them only scrolls.
const NAV_GROUPS: { group: string; items: { id: string; icon: IconName; label: string; always?: boolean }[] }[] = [
  {
    group: "Your CV",
    items: [
      { id: "master-cv", icon: "document", label: "Master CV", always: true },
      { id: "your-details", icon: "user", label: "Your details", always: true },
    ],
  },
  {
    group: "Tailoring",
    items: [
      { id: "eligibility", icon: "shield", label: "Eligibility" },
      { id: "claims", icon: "verified", label: "Claims registry" },
      { id: "variants", icon: "target", label: "Positioning" },
    ],
  },
  {
    group: "Document",
    items: [
      { id: "section-order", icon: "list", label: "Section order" },
      { id: "cv-length", icon: "document", label: "CV length" },
      { id: "right-to-work", icon: "globe", label: "Right to Work" },
      { id: "advanced", icon: "sliders", label: "Project pool" },
    ],
  },
];

// Reorder the CV's standard sections. Section ORDER only — bullet counts and
// content are untouched and still come from the tailoring run.
//
// No drag-and-drop library: this is a five-item single-column list, and the
// project's guidance is not to add dependencies for small problems. Native
// HTML5 drag handles the mouse; the ↑/↓ buttons cover keyboard, screen readers
// and touch, which drag alone would not.
export default function CustomizePage() {
  const router = useRouter();
  const [order, setOrder] = useState<SectionId[]>(DEFAULT_SECTION_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Identity for the /app workspace — used to drop a stale tailored result
  // when the master CV changes here (project bullets are index-keyed against
  // the profile's project list, so a result built from the old CV could
  // otherwise render bullets under the wrong project on /app).
  const [userId, setUserId] = useState<string | null>(null);

  // Master CV
  const [masterCvText, setMasterCvText] = useState("");
  const [cvDraft, setCvDraft] = useState("");
  const [editingCv, setEditingCv] = useState(false);
  const [cvSavedAt, setCvSavedAt] = useState<number | null>(null);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState("");
  // Set when a CV is populated from an uploaded file, so the user is told to
  // check the extraction before saving. Cleared once they edit or save.
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Inline two-step confirms (no blocking window.confirm): replacing the CV is
  // destructive, and re-running extraction spends an AI call.
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmReextract, setConfirmReextract] = useState(false);
  const [reextracting, setReextracting] = useState(false);

  // Profile details — extracted from the master CV, edited here.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  // Extraction can fail while the CV itself saved fine; the user needs to
  // know, because a missing profile means a CV headed "YOUR NAME".
  const [profileError, setProfileError] = useState("");

  // Advanced customization — the full project pool (master_cvs.projects_pool).
  // When saved, every tailor run selects the 2 most relevant pool projects
  // instead of tailoring the master CV's own projects.
  const [poolDraft, setPoolDraft] = useState("");
  const [poolSaved, setPoolSaved] = useState(false);
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolMsg, setPoolMsg] = useState("");
  const [poolError, setPoolError] = useState("");

  // Eligibility profile (user_settings.eligibility): the answers an
  // application form asks before anyone reads the CV. The pre-check on /app
  // compares each job's gates against these. Typed by the user, never
  // inferred from the CV; "not set" answers "unknown", never pass or fail.
  const [eligibility, setEligibility] = useState<Eligibility>(EMPTY_ELIGIBILITY);
  const [eligLoaded, setEligLoaded] = useState(false);
  // One-time nudge for a "Full right to work" answer: "full" means permanent,
  // and a visa holder who picked it gets no warning on postings that ask for
  // permanent status. Dismissed per user in localStorage.
  const [rtwBannerDismissed, setRtwBannerDismissed] = useState(false);
  const [settingsMissing, setSettingsMissing] = useState(false);
  const [eligSaving, setEligSaving] = useState(false);
  const [eligMsg, setEligMsg] = useState("");
  const [eligError, setEligError] = useState("");
  // The three list fields are typed as comma-separated text.
  const [eligCountries, setEligCountries] = useState("");
  const [eligBases, setEligBases] = useState("");
  const [eligLicences, setEligLicences] = useState("");

  // Claims registry (user_settings.claims): each skill's level, seeded from
  // the CV on extraction, confirmed once by the user. Tailoring may describe
  // a skill only at or below its level; learning skills never appear.
  const [claims, setClaims] = useState<ClaimsRegistry | null>(null);
  const [claimsSaving, setClaimsSaving] = useState(false);
  const [claimsMsg, setClaimsMsg] = useState("");
  const [claimsError, setClaimsError] = useState("");
  const [showFigures, setShowFigures] = useState(false);

  // Positioning variants (user_settings.variants): headline + lead skills per
  // role family, applied to the one master CV. Drafted here, saved as one.
  const [variantsDraft, setVariantsDraft] = useState<Variant[]>([]);
  const [leadSkillsText, setLeadSkillsText] = useState<Record<string, string>>({});
  const [variantsColumnMissing, setVariantsColumnMissing] = useState(false);
  const [variantsSaving, setVariantsSaving] = useState(false);
  const [variantsMsg, setVariantsMsg] = useState("");
  const [variantsError, setVariantsError] = useState("");
  // Document preferences (user_settings.preferences): Right to Work off the
  // CV by default. Saved on toggle; reverted if the save fails.
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [prefsColumnMissing, setPrefsColumnMissing] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState("");
  const [prefsError, setPrefsError] = useState("");
  // Which section the last preference save message belongs to.
  const [prefsMsgAt, setPrefsMsgAt] = useState<"rtw" | "length">("rtw");

  // ── Section disclosure ────────────────────────────────────────────────────
  // Held here rather than inside CollapsibleSection so the nav can open a
  // section and scroll to it in one click. Master CV and Your details are not
  // in this set — they are always open.
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set<string>());
  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function goToSection(id: string, always?: boolean) {
    if (!always) setOpenSections((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    // Scrolling to the header is safe before the expansion paints: a section
    // grows downward, so its own top doesn't move.
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function updatePrefs(patch: Partial<Omit<Preferences, "version">>, at: "rtw" | "length", okMsg: string) {
    const previous = prefs;
    const updated: Preferences = { ...prefs, ...patch };
    setPrefs(updated);
    setPrefsMsg("");
    setPrefsError("");
    setPrefsMsgAt(at);
    const res = await savePreferences(updated);
    if (res.ok) {
      setPrefsMsg(okMsg);
      return;
    }
    setPrefs(previous);
    if (res.missingTable) setPrefsError("Your database doesn't have the user_settings table yet — run supabase/migrations/20260917120000_user_settings_and_jd_lookup.sql first.");
    else if (res.missingColumn) {
      setPrefsColumnMissing(true);
      setPrefsError("Your database doesn't have this setting's column yet — run supabase/migrations/20260918120000_user_settings_preferences.sql in the Supabase SQL editor, then try again.");
    } else setPrefsError("Couldn't save. Check your connection and try again.");
  }
  function toggleRightToWorkOnCv(next: boolean) {
    void updatePrefs(
      { includeRightToWorkOnCv: next },
      "rtw",
      next ? "Saved — Right to Work will appear on the CV document." : "Saved — Right to Work stays off the CV document."
    );
  }
  function setCvLength(onePageCv: boolean) {
    void updatePrefs(
      { onePageCv },
      "length",
      onePageCv
        ? "Saved — every CV you tailor from now on is fitted to one page."
        : "Saved — every CV you tailor from now on is fitted to two pages."
    );
  }
  const claimsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (claimsSaveTimer.current) clearTimeout(claimsSaveTimer.current); }, []);
  // The figures the checker will accept, straight from the saved CV (and
  // shown so the user knows what "registered" means).
  const figureKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const f of extractFigures(masterCvText)) seen.add(f.key);
    return [...seen];
  }, [masterCvText]);
  const claimsStale = !!claims?.seededFrom && !!masterCvText && claims.seededFrom !== cvFingerprint(masterCvText);
  // Sections the CV seems to list more of than extraction returned - shown
  // for the user to check, never auto-corrected.
  const extractionIssues =
    profile && masterCvText
      ? extractionFlags(masterCvText, {
          projects: profile.projects.length,
          education: profile.education.length,
          certifications: profile.certifications.length,
        })
      : [];
  const unconfirmedCount = countUnconfirmed(claims);

  useEffect(() => {
    let active = true;
    async function load() {
      // The page is auth-gated by proxy.ts, but bounce defensively if the
      // session vanished between navigation and mount.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login?next=/customize");
        return;
      }
      setUserId(session.user.id);
      try {
        setRtwBannerDismissed(localStorage.getItem(rtwBannerKey(session.user.id)) === "1");
      } catch {
        // Storage blocked: the nudge just shows each visit.
      }

      try {
        const res = await fetch("/api/section-order");
        const data = await res.json();
        if (!active) return;
        if (res.ok) setOrder(resolveSectionOrder(data.order));
      } catch {
        // Fall back to the default order — the page still works, and saving
        // will surface any real problem.
      } finally {
        if (active) setLoading(false);
      }

      let stored = await getMasterCV();
      if (!stored) {
        // First login, or user hasn't saved a CV yet — check localStorage for
        // a one-time migration of any pre-auth CV.
        const imported = await importFromLocalStorageIfNeeded();
        if (imported) stored = imported;
      }
      if (!active) return;
      if (stored) {
        setMasterCvText(stored.text);
        setCvSavedAt(stored.updatedAt);
        if (stored.projectsPool) {
          setPoolDraft(stored.projectsPool);
          setPoolSaved(true);
        }
      } else {
        setEditingCv(true); // no CV yet — open the editor so they set one
      }
      setCvLoading(false);

      const p = await getProfile();
      if (active) {
        setProfile(p);
        setProfileLoading(false);
      }

      const settings = await getUserSettings();
      if (active) {
        setSettingsMissing(settings.missingTable);
        // An empty registry is never the resting state: seed it from the CV's
        // own skills section and keep it (best effort, degrades quietly).
        let registry = normalizeClaims(settings.claims);
        if ((!registry || registry.skills.length === 0) && stored?.text.trim()) {
          const seeded = seedClaimsFromCv(stored.text);
          if (seeded.skills.length > 0) {
            registry = seeded;
            void saveClaims(seeded);
          }
        }
        setClaims(registry);
        setVariantsColumnMissing(settings.variantsColumnMissing);
        setPrefs(normalizePreferences(settings.preferences));
        setPrefsColumnMissing(settings.preferencesColumnMissing);
        const vc = normalizeVariants(settings.variants);
        if (vc) {
          setVariantsDraft(vc.variants);
          setLeadSkillsText(Object.fromEntries(vc.variants.map((v) => [v.id, v.leadSkills.join(", ")])));
        }
        if (settings.eligibility) {
          setEligibility(settings.eligibility);
          setEligCountries(settings.eligibility.rightToWork.countries.join(", "));
          setEligBases(settings.eligibility.location.base.join(", "));
          setEligLicences(settings.eligibility.licences.join(", "));
        } else if (p && p.certifications.length > 0) {
          // First visit: the licences box starts from the CV's own
          // certifications list (the user's text, labelled as such). Nothing
          // else is prefilled - eligibility answers are never inferred.
          setEligLicences(p.certifications.join(", "));
        }
        setEligLoaded(true);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  // One upsert per pause in typing, not per keystroke — the previous version
  // sent the whole profile on every character, and out-of-order responses
  // could persist a stale value.
  const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current); }, []);

  function updateProfileField(field: keyof Profile, value: string) {
    if (!profile) return;
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = setTimeout(() => {
      saveProfile(updated).then((ok) => {
        setProfileError(ok ? "" : "Couldn't save that change. Check your connection and try again.");
      });
    }, 500);
  }

  // Drops any tailored result sitting in the /app workspace without touching
  // the pasted job description — the JD is independent of the CV, but a
  // tailored result is not.
  function invalidateWorkspaceResult() {
    if (!userId) return;
    const existing = loadWorkspace(userId);
    saveWorkspace(userId, { jobDescription: existing?.jobDescription ?? "", result: null, ranProvider: null });
  }

  // Save (or clear, with empty text) the project pool. A result tailored
  // against the old pool is stale for the same reason a CV edit makes one
  // stale, so both paths invalidate the workspace result.
  async function handleSavePool(clear: boolean) {
    const pool = clear ? "" : poolDraft.trim();
    setPoolMsg("");
    setPoolError("");
    if (!clear && !pool) {
      setPoolError("Paste your projects first, or use Remove pool to switch this off.");
      return;
    }
    if (pool.length > MAX_POOL_CHARS) {
      setPoolError(`Project pool is too long (${pool.length.toLocaleString()} / ${MAX_POOL_CHARS.toLocaleString()} characters).`);
      return;
    }
    setPoolSaving(true);
    const res = await saveProjectsPool(pool);
    setPoolSaving(false);
    if (res.ok) {
      setPoolDraft(pool);
      setPoolSaved(!clear);
      invalidateWorkspaceResult();
      setPoolMsg(clear
        ? "Pool removed. Tailoring uses the projects from your master CV again."
        : "Saved. Every tailor run now picks the 2 most relevant projects from this pool.");
    } else if (res.missingColumn) {
      setPoolError("Your database doesn't have this feature's column yet — run supabase/migrations/20260911120000_master_cvs_projects_pool.sql in the Supabase SQL editor, then save again.");
    } else {
      setPoolError("Couldn't save the pool. Check your connection and try again.");
    }
  }

  function updateElig(patch: (e: Eligibility) => Eligibility) {
    setEligibility((e) => patch(e));
    setEligMsg("");
    setEligError("");
  }
  const splitList = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const tri = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");
  const fromTri = (s: string): boolean | null => (s === "yes" ? true : s === "no" ? false : null);

  async function handleSaveEligibility() {
    setEligMsg("");
    setEligError("");
    setEligSaving(true);
    const next = normalizeEligibility({
      ...eligibility,
      rightToWork: { ...eligibility.rightToWork, countries: splitList(eligCountries) },
      location: { ...eligibility.location, base: splitList(eligBases) },
      licences: splitList(eligLicences),
    });
    const res = await saveEligibility(next);
    setEligSaving(false);
    if (res.ok) {
      setEligibility(next);
      setEligCountries(next.rightToWork.countries.join(", "));
      setEligBases(next.location.base.join(", "));
      setEligLicences(next.licences.join(", "));
      setEligMsg("Saved. The pre-check on the tailoring page now compares each job's eligibility conditions against these answers.");
    } else if (res.missingTable) {
      setSettingsMissing(true);
      setEligError("Your database doesn't have this feature's table yet — run supabase/migrations/20260917120000_user_settings_and_jd_lookup.sql in the Supabase SQL editor, then save again.");
    } else {
      setEligError("Couldn't save. Check your connection and try again.");
    }
  }

  // Seed or refresh the claims registry from the CV itself plus the
  // extraction's skill guesses (seedClaimsFromCv: levels read from where the
  // CV shows each skill used, never promoted). Confirmed levels survive
  // (mergeClaims); a seed that named no skills leaves the registry alone.
  async function reseedClaims(cvText: string, guesses: unknown) {
    const seed = seedClaimsFromCv(cvText, normalizeSkillGuesses(guesses));
    if (seed.skills.length === 0) return;
    const merged = mergeClaims(claims, seed);
    setClaims(merged);
    const res = await saveClaims(merged);
    if (res.missingTable) setSettingsMissing(true);
  }

  function persistClaims(next: ClaimsRegistry, message: string) {
    setClaims(next);
    setClaimsMsg("");
    setClaimsError("");
    if (claimsSaveTimer.current) clearTimeout(claimsSaveTimer.current);
    claimsSaveTimer.current = setTimeout(async () => {
      setClaimsSaving(true);
      const res = await saveClaims(next);
      setClaimsSaving(false);
      if (res.ok) setClaimsMsg(message);
      else if (res.missingTable) {
        setSettingsMissing(true);
        setClaimsError("Your database doesn't have this feature's table yet — run supabase/migrations/20260917120000_user_settings_and_jd_lookup.sql in the Supabase SQL editor.");
      } else setClaimsError("Couldn't save that change. Check your connection and try again.");
    }, 400);
  }

  // A deliberate click on a chip is that skill's confirmation.
  function cycleLevel(name: string) {
    if (!claims) return;
    const next: ClaimsRegistry = {
      ...claims,
      skills: claims.skills.map((s) => (s.name === name ? { ...s, level: NEXT_LEVEL[s.level], confirmed: true } : s)),
    };
    persistClaims(next, "Saved.");
  }

  function handleConfirmClaims() {
    if (!claims) return;
    const next: ClaimsRegistry = {
      ...claims,
      skills: claims.skills.map((s) => ({ ...s, confirmed: true })),
      confirmedAt: claims.confirmedAt ?? new Date().toISOString(),
    };
    persistClaims(next, "Levels confirmed. From now on a figure that isn't on your CV, or a learning skill in the output, blocks the download until you fix it.");
  }

  function updateVariant(id: string, patch: Partial<Variant>) {
    setVariantsDraft((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    setVariantsMsg("");
    setVariantsError("");
  }
  function addVariant() {
    if (variantsDraft.length >= MAX_VARIANTS) return;
    const id = newVariantId();
    setVariantsDraft((list) => [...list, { id, name: "", headline: "", roleTypes: [], leadSkills: [] }]);
    setLeadSkillsText((m) => ({ ...m, [id]: "" }));
    setVariantsMsg("");
  }
  function removeVariant(id: string) {
    setVariantsDraft((list) => list.filter((v) => v.id !== id));
    setVariantsMsg("");
  }
  async function handleSaveVariants() {
    setVariantsMsg("");
    setVariantsError("");
    const config: VariantsConfig | null = normalizeVariants({
      variants: variantsDraft.map((v) => ({ ...v, leadSkills: splitList(leadSkillsText[v.id] ?? "") })),
    });
    const dropped = variantsDraft.filter((v) => !v.name.trim()).length;
    setVariantsSaving(true);
    const res = await saveVariants(config && config.variants.length > 0 ? config : null);
    setVariantsSaving(false);
    if (res.ok) {
      const saved = config?.variants ?? [];
      setVariantsDraft(saved);
      setLeadSkillsText(Object.fromEntries(saved.map((v) => [v.id, v.leadSkills.join(", ")])));
      setVariantsMsg(
        saved.length === 0
          ? "Saved with no variants — tailoring uses your CV's own positioning."
          : `Saved ${saved.length} variant${saved.length === 1 ? "" : "s"}${dropped ? ` (${dropped} without a name dropped)` : ""}. The pre-check picks one by the posting's role type; you can override it per run.`
      );
    } else if (res.missingColumn || res.missingTable) {
      setVariantsColumnMissing(true);
      setVariantsError("Your database doesn't have this feature's column yet — run supabase/migrations/20260917130000_user_settings_variants.sql in the Supabase SQL editor, then save again.");
    } else {
      setVariantsError("Couldn't save. Check your connection and try again.");
    }
  }

  async function handleSaveCv() {
    if (extracting) return; // a second click mid-save would spend a second extraction call
    // A CV pasted from a markdown file carries **bold** and [label](url)
    // syntax that would otherwise leak literally into every output — the CV
    // text is quoted verbatim by the prompts and captured verbatim by
    // extraction. Clean it here and reflect the cleaned text in the box, so
    // what's stored is exactly what the user sees.
    const draft = stripMarkdown(cvDraft).trim();
    if (draft !== cvDraft) setCvDraft(draft);
    if (!draft) {
      setCvError("Paste your CV before saving.");
      return;
    }
    if (draft.length > MAX_CV_CHARS) {
      setCvError(
        `Your CV is ${draft.length.toLocaleString()} characters — the limit is ${MAX_CV_CHARS.toLocaleString()}. Trim it, or keep just the sections that matter.`
      );
      return;
    }
    setCvError("");
    setExtracting(true);
    try {
      const rec = await saveMasterCV(draft);
      if (!rec) {
        setCvError("Couldn't save your CV. Check your connection and try again.");
        return;
      }
      setMasterCvText(rec.text);
      setCvSavedAt(rec.updatedAt);
      setUploadNotice(null);
      invalidateWorkspaceResult();

      // Extract the profile (name/contact/education) from the new CV. The CV
      // is already saved at this point; a failure here is reported, not hidden.
      let extractError = "";
      try {
        const res = await fetch("/api/extract-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cvText: rec.text }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.profile) {
          setProfile(data.profile);
          const persisted = await saveProfile(data.profile);
          await reseedClaims(rec.text, data.skills);
          if (!persisted) {
            extractError = "Your CV is saved, but your details couldn't be stored. Reload and try Edit → Save again.";
          }
        } else {
          extractError = data.error
            ? `Your CV is saved, but reading your details out of it failed: ${data.error}`
            : "Your CV is saved, but your details couldn't be read out of it. Try Edit → Save again.";
        }
      } catch {
        extractError = "Your CV is saved, but the server couldn't be reached to read your details. Try Edit → Save again.";
      }
      setProfileError(extractError);
      setEditingCv(false);
    } finally {
      setExtracting(false);
    }
  }

  function handleEditCv() {
    setCvDraft(masterCvText);
    setEditingCv(true);
  }

  async function handleClearCv() {
    // Destructive and irreversible — reached only through the inline two-step
    // confirm below, so no blocking window.confirm here.
    setConfirmReplace(false);
    // Reset UI immediately so the user doesn't wait for the DB delete
    setProfile(null);
    setMasterCvText("");
    setCvSavedAt(null);
    setCvDraft("");
    setEditingCv(true);
    setUploadNotice(null);
    // The row delete below takes projects_pool with it — mirror that in the UI.
    setPoolDraft("");
    setPoolSaved(false);
    setPoolMsg("");
    setPoolError("");
    invalidateWorkspaceResult();
    // Delete from DB in the background
    // A replaced CV starts a fresh registry (eligibility is kept - it isn't
    // CV-derived).
    setClaims(null);
    await clearMasterCV();
    await clearProfile();
    await saveClaims(null);
  }

  // Re-runs profile extraction against the SAVED master CV — the recovery path
  // when extraction failed on save, or when the extracted details look wrong.
  // Spends one AI call, hence the two-step confirm in the UI.
  async function handleReextract() {
    if (!masterCvText || reextracting || extracting) return;
    setConfirmReextract(false);
    setReextracting(true);
    setProfileError("");
    try {
      const res = await fetch("/api/extract-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvText: masterCvText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.profile) {
        // Non-destructive: the eight contact fields keep whatever the user
        // has now (their edits included); the structured sections take the
        // fresh read.
        const merged = mergeProfileEdits(profile, data.profile as Profile);
        setProfile(merged);
        const persisted = await saveProfile(merged);
        await reseedClaims(masterCvText, data.skills);
        if (persisted) {
          // The project list may have changed shape — a tailored result keyed
          // by the old project indexes must not survive it.
          invalidateWorkspaceResult();
        } else {
          setProfileError("Extraction worked, but the result couldn't be stored. Try again.");
        }
      } else {
        setProfileError(
          data.error
            ? `Re-running extraction failed: ${data.error}`
            : "Re-running extraction failed. Try again."
        );
      }
    } catch {
      setProfileError("Couldn't reach the server to re-run extraction. Try again.");
    } finally {
      setReextracting(false);
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSavedMsg("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch("/api/section-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save. Please try again.");
      } else {
        setSavedMsg(
          isDefaultOrder(order)
            ? "Saved — you're back on the standard order."
            : "Saved. Every CV you tailor from now on uses this order."
        );
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // Summary lines for the collapsed sections. A folded section still states
  // what it holds, so nothing is hidden — only put away.
  const eligAnswered = eligibilityAnswered(eligibility);
  const eligSet = isEligibilitySet(eligibility);
  const claimsTotal = claims?.skills.length ?? 0;
  const claimsUnconfirmed = countUnconfirmed(claims);
  const orderIsCustom = order.join() !== DEFAULT_SECTION_ORDER.join();
  const poolLength = poolDraft.trim().length;

  return (
    <main className="page">
      <div className="container cstContainer">
        <AppHeader
          title="Customize"
          tagline="Manage your master CV, your details, and how your tailored CV is laid out."
        />

        <div className="cstLayout">
          <nav className="cstNav" aria-label="Sections">
            {NAV_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="cstNavGroup">{g.group}</div>
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="cstNavItem"
                    onClick={() => goToSection(item.id, item.always)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="cstMain">
        <Card id="master-cv">
          {cvLoading ? (
            <>
              <div className="label">Master CV</div>
              <Skeleton lines={3} label="Loading your CV" />
            </>
          ) : editingCv ? (
            <FormField
              label="Master CV"
              htmlFor="cv"
              help="Add your full CV once. It's saved to your account and reused for every job — you'll only need to paste the job description on the main page each time."
            >
              <CvUpload
                disabled={extracting}
                onExtracted={(text, meta) => {
                  // Populate the SAME textarea the paste flow uses. Nothing is
                  // saved yet — the user reviews and edits, then hits Save.
                  // Markdown cleanup applies to uploads too (.md files arrive
                  // through the plain-text path).
                  setCvDraft(stripMarkdown(text));
                  setCvError("");
                  setUploadNotice(
                    `Text extracted from ${meta.filename} (${meta.characters.toLocaleString()} characters). ` +
                    `Check it below before saving — PDFs and Word files can lose formatting, so fix any run-together ` +
                    `lines or missing headings now.`
                  );
                }}
              />

              <div className="orDivider"><span>or paste it below</span></div>

              {uploadNotice && (
                <p className="uploadNotice" role="status">{uploadNotice}</p>
              )}

              <Textarea
                id="cv"
                value={cvDraft}
                onChange={(e) => {
                  setCvDraft(e.target.value);
                  if (uploadNotice) setUploadNotice(null);
                }}
                placeholder="Paste your full CV here…"
                rows={10}
                disabled={extracting}
              />
              <p className={"charCount" + (cvDraft.length > MAX_CV_CHARS ? " over" : "")} aria-live="polite">
                {cvDraft.length.toLocaleString()} / {MAX_CV_CHARS.toLocaleString()}
              </p>
              <div className="actions">
                <Button onClick={handleSaveCv} disabled={extracting}>
                  {extracting ? "Saving…" : "Save master CV"}
                </Button>
                {masterCvText && (
                  <Button variant="secondary" onClick={() => setEditingCv(false)} disabled={extracting}>Cancel</Button>
                )}
                {cvError && <StatusText as="span" role="alert">{cvError}</StatusText>}
              </div>
            </FormField>
          ) : (
            <div className="cvSavedRow">
              <div>
                <div className="cvSavedLabel">✓ Master CV saved</div>
                {cvSavedAt && (
                  <div className="cvSavedMeta">Last updated {new Date(cvSavedAt).toLocaleDateString()}</div>
                )}
              </div>
              <div className="cvSavedActions">
                {confirmReplace ? (
                  <>
                    <StatusText as="span">Delete your saved CV and extracted details?</StatusText>
                    <Button variant="ghost" className="keyRemove" onClick={handleClearCv}>
                      Yes, replace
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmReplace(false)}>Keep it</Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={handleEditCv}>Edit</Button>
                    <Button variant="ghost" onClick={() => setConfirmReplace(true)}>Replace</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card id="your-details">
          <SectionHeading icon="user">
            Your details {extracting && <span className="cvSavedMeta">— extracting…</span>}
          </SectionHeading>
          {profileError && <p role="alert" className="keyError">{profileError}</p>}
          {profileLoading ? (
            <Skeleton lines={2} label="Loading your details" />
          ) : profile ? (
            <>
              <p className="cvHelp">Pulled from your CV. Check these are right — they appear in your tailored CV&apos;s header and sections.</p>
              <div className="profileGrid">
                <label>Name<Input value={profile.name} onChange={(e) => updateProfileField("name", e.target.value)} /></label>
                <label>Tagline<Input value={profile.tagline} onChange={(e) => updateProfileField("tagline", e.target.value)} /></label>
                <label>Location<Input value={profile.location} onChange={(e) => updateProfileField("location", e.target.value)} /></label>
                <label>Phone<Input value={profile.phone} onChange={(e) => updateProfileField("phone", e.target.value)} /></label>
                <label>Email<Input value={profile.email} onChange={(e) => updateProfileField("email", e.target.value)} /></label>
                <label>LinkedIn<Input value={profile.linkedin} onChange={(e) => updateProfileField("linkedin", e.target.value)} /></label>
                <label>GitHub<Input value={profile.github} onChange={(e) => updateProfileField("github", e.target.value)} /></label>
                <label>Website<Input value={profile.website} onChange={(e) => updateProfileField("website", e.target.value)} /></label>
              </div>

              {extractionIssues.map((f) => (
                <StatusText key={f.section} className="msgBelow" role="alert" data-extraction-flag={f.section}>
                  Your CV&apos;s {f.label} section seems to list {f.expected} entries, but {f.got}{" "}
                  {f.got === 1 ? "was" : "were"} extracted. Check the list below; if something is missing,
                  re-run extraction.
                </StatusText>
              ))}

              {(profile.projects.length > 0 ||
                profile.education.length > 0 ||
                profile.certifications.length > 0 ||
                (profile.extraSections?.length ?? 0) > 0) && (
                <div className="extractSummary">
                  <div className="extractLabel">Also extracted from your CV</div>
                  <dl className="extractGrid">
                    {profile.projects.length > 0 && (
                      <div className="extractRow">
                        <dt>Projects ({profile.projects.length})</dt>
                        <dd>
                          {profile.projects
                            .map((pr) => splitTrailingDate(pr.name || "").title || pr.name)
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    {profile.education.length > 0 && (
                      <div className="extractRow">
                        <dt>Education ({profile.education.length})</dt>
                        <dd>
                          {profile.education
                            .map((e) => [e.degree, e.institution].filter(Boolean).join(" — "))
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    {profile.certifications.length > 0 && (
                      <div className="extractRow">
                        <dt>Certifications ({profile.certifications.length})</dt>
                        <dd>{profile.certifications.join(" · ")}</dd>
                      </div>
                    )}
                    {(profile.extraSections?.length ?? 0) > 0 && (
                      <div className="extractRow">
                        <dt>Extra sections</dt>
                        <dd>{(profile.extraSections ?? []).map((s) => s.title).join(" · ")}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="cvHelp cvHelpTight">
                    This just shows what was read out of your CV — the wording itself is edited
                    inline on the tailored CV preview.
                  </p>
                </div>
              )}
            </>
          ) : masterCvText ? (
            <p className="cvHelp">
              Your CV is saved, but no details have been extracted from it yet — run the
              extraction below.
            </p>
          ) : (
            <p className="cvHelp">
              No details yet — add your master CV above and these will be extracted automatically.
            </p>
          )}
          {!profileLoading && masterCvText && (
            <div className="actions">
              {confirmReextract ? (
                <>
                  <StatusText as="span">Re-running uses one AI call — continue?</StatusText>
                  <Button variant="secondary" onClick={handleReextract} disabled={reextracting}>
                    Yes, re-run
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmReextract(false)} disabled={reextracting}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmReextract(true)}
                  disabled={reextracting || extracting || editingCv}
                >
                  {reextracting ? "Re-running extraction…" : "Re-run extraction"}
                </Button>
              )}
            </div>
          )}
        </Card>

        {/* Eligibility — the form questions that get an application rejected
            before the CV is read. Compared by the pre-check on /app. */}
        <CollapsibleSection
          id="eligibility"
          icon="shield"
          title="Eligibility"
          open={openSections.has("eligibility")}
          onToggle={toggleSection}
          tone={eligSet ? (eligAnswered === ELIGIBILITY_QUESTIONS ? "ok" : "neutral") : "warn"}
          summary={
            eligSet
              ? `${eligAnswered} of ${ELIGIBILITY_QUESTIONS} answered`
              : "Not set — the pre-check can't warn you"
          }
        >
          <p className="cvHelp">
            The questions an application form asks before anyone reads your CV: right to work, clearance,
            years, location, degree, licences, contract type. Answer once; the pre-check on the tailoring
            page then warns when a job has a condition you&apos;d fail, before a tailor is spent. Nothing here
            is guessed from your CV — leave anything you&apos;re unsure of as &quot;Not set&quot;.
          </p>
          {!eligLoaded ? (
            <Skeleton lines={3} label="Loading your eligibility answers" />
          ) : (
            <>
              {settingsMissing && (
                <p className="fitEvidence">
                  This feature&apos;s database table isn&apos;t set up yet (migration
                  20260917120000_user_settings_and_jd_lookup.sql). Answers can&apos;t be saved until it is.
                </p>
              )}
              {profile && profile.rightToWork.length > 0 && (
                <p className="fitEvidence">Your CV says: {profile.rightToWork.join(" · ")}</p>
              )}
              {eligibility.rightToWork.status === "full" && !rtwBannerDismissed && (
                <div className="limitNotice" role="status" data-rtw-full-banner>
                  <div className="limitNotice__title">Is your right to work permanent?</div>
                  <div className="limitNotice__body">
                    &quot;Full right to work&quot; means settled status, indefinite leave to remain or citizenship. On a
                    Student, Graduate or Skilled Worker visa, choose &quot;Time-limited visa&quot; instead: postings that
                    ask for permanent right to work are then flagged before a credit is spent, and the answer stays
                    true when a form asks whether you will ever need sponsorship.
                  </div>
                  <div className="limitNotice__cta">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setRtwBannerDismissed(true);
                        try {
                          if (userId) localStorage.setItem(rtwBannerKey(userId), "1");
                        } catch {
                          // Storage blocked: dismissed for this visit only.
                        }
                      }}
                    >
                      Mine is permanent
                    </Button>
                  </div>
                </div>
              )}
              <div className="profileGrid eligGrid">
                <label>
                  Right to work
                  <select
                    className="appsSelect"
                    value={eligibility.rightToWork.status}
                    onChange={(e) => {
                      const status = e.target.value as Eligibility["rightToWork"]["status"];
                      updateElig((x) => ({ ...x, rightToWork: { ...x.rightToWork, status } }));
                    }}
                  >
                    <option value="unknown">Not set</option>
                    <option value="full">Full right to work — permanent, no sponsorship ever needed</option>
                    <option value="time_limited">Time-limited visa — no sponsorship needed to start, will need it later</option>
                    <option value="needs_sponsorship">I need visa sponsorship</option>
                  </select>
                </label>
                <label>
                  Countries you can work in
                  <Input value={eligCountries} onChange={(e) => { setEligCountries(e.target.value); setEligMsg(""); }} placeholder="e.g. UK, Ireland" />
                </label>
                {eligibility.rightToWork.status === "time_limited" && (
                  <label>
                    Current permission ends (month/year, optional)
                    <Input
                      type="month"
                      value={eligibility.rightToWork.permissionEnds ?? ""}
                      onChange={(e) => {
                        const permissionEnds = e.target.value || null;
                        updateElig((x) => ({ ...x, rightToWork: { ...x.rightToWork, permissionEnds } }));
                      }}
                    />
                  </label>
                )}
                <label>
                  Security clearance held
                  <select
                    className="appsSelect"
                    value={eligibility.clearance.held}
                    onChange={(e) => {
                      const held = e.target.value as Eligibility["clearance"]["held"];
                      updateElig((x) => ({ ...x, clearance: { ...x.clearance, held } }));
                    }}
                  >
                    <option value="unknown">Not set</option>
                    <option value="none">None</option>
                    <option value="bpss">BPSS</option>
                    <option value="ctc">CTC</option>
                    <option value="sc">SC</option>
                    <option value="dv">DV</option>
                  </select>
                </label>
                <label>
                  Eligible to be cleared (e.g. 5 years UK residency)
                  <select
                    className="appsSelect"
                    value={tri(eligibility.clearance.eligible)}
                    onChange={(e) => { const eligible = fromTri(e.target.value); updateElig((x) => ({ ...x, clearance: { ...x.clearance, eligible } })); }}
                  >
                    <option value="unknown">Not set</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label>
                  Years of professional experience
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={eligibility.yearsExperience ?? ""}
                    onChange={(e) => { const raw = e.target.value; updateElig((x) => ({ ...x, yearsExperience: raw === "" ? null : Number(raw) })); }}
                    placeholder="Not set"
                  />
                </label>
                <label>
                  Base location(s)
                  <Input value={eligBases} onChange={(e) => { setEligBases(e.target.value); setEligMsg(""); }} placeholder="e.g. London" />
                </label>
                <label>
                  On-site roles
                  <select className="appsSelect" value={tri(eligibility.location.onsiteOk)} onChange={(e) => { const onsiteOk = fromTri(e.target.value); updateElig((x) => ({ ...x, location: { ...x.location, onsiteOk } })); }}>
                    <option value="unknown">Not set</option>
                    <option value="yes">Fine with me</option>
                    <option value="no">Rather not</option>
                  </select>
                </label>
                <label>
                  Hybrid roles
                  <select className="appsSelect" value={tri(eligibility.location.hybridOk)} onChange={(e) => { const hybridOk = fromTri(e.target.value); updateElig((x) => ({ ...x, location: { ...x.location, hybridOk } })); }}>
                    <option value="unknown">Not set</option>
                    <option value="yes">Fine with me</option>
                    <option value="no">Rather not</option>
                  </select>
                </label>
                <label>
                  Willing to relocate
                  <select className="appsSelect" value={tri(eligibility.location.relocateOk)} onChange={(e) => { const relocateOk = fromTri(e.target.value); updateElig((x) => ({ ...x, location: { ...x.location, relocateOk } })); }}>
                    <option value="unknown">Not set</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label>
                  Highest degree
                  <select
                    className="appsSelect"
                    value={eligibility.degree.level}
                    onChange={(e) => { const level = e.target.value as Eligibility["degree"]["level"]; updateElig((x) => ({ ...x, degree: { ...x.degree, level } })); }}
                  >
                    <option value="unknown">Not set</option>
                    <option value="none">No degree</option>
                    <option value="bachelors">Bachelor&apos;s</option>
                    <option value="masters">Master&apos;s</option>
                    <option value="phd">PhD</option>
                  </select>
                </label>
                <label>
                  Degree classification
                  <select
                    className="appsSelect"
                    value={eligibility.degree.classification}
                    onChange={(e) => { const classification = e.target.value as Eligibility["degree"]["classification"]; updateElig((x) => ({ ...x, degree: { ...x.degree, classification } })); }}
                  >
                    <option value="unknown">Not set</option>
                    <option value="first">First</option>
                    <option value="2:1">2:1</option>
                    <option value="2:2">2:2</option>
                    <option value="other">Other / not on the UK scale</option>
                  </select>
                </label>
                <label>
                  Licences and certifications you hold
                  <Input value={eligLicences} onChange={(e) => { setEligLicences(e.target.value); setEligMsg(""); }} placeholder="e.g. Full UK driving licence, AWS Solutions Architect" />
                </label>
              </div>
              <div className="eligChecks">
                <span className="eligChecksLabel">Contract types you&apos;d take (leave all unticked for no preference)</span>
                {(
                  [
                    ["permanent", "Permanent"],
                    ["contract", "Contract"],
                    ["fixed_term", "Fixed-term"],
                    ["internship", "Internship"],
                    ["part_time", "Part-time"],
                  ] as [EmploymentType, string][]
                ).map(([t, label]) => (
                  <label key={t} className="eligCheck">
                    <input
                      type="checkbox"
                      checked={eligibility.employmentTypes.includes(t)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        updateElig((x) => ({
                          ...x,
                          employmentTypes: on ? [...x.employmentTypes.filter((y) => y !== t), t] : x.employmentTypes.filter((y) => y !== t),
                        }));
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="actions">
                <Button onClick={handleSaveEligibility} disabled={eligSaving || settingsMissing}>
                  {eligSaving ? "Saving…" : "Save eligibility"}
                </Button>
                {isEligibilitySet(eligibility) && eligibility.updatedAt && (
                  <span className="cvSavedMeta">Last saved {new Date(eligibility.updatedAt).toLocaleDateString()}</span>
                )}
              </div>
              {eligError && <StatusText className="msgBelow" role="alert">{eligError}</StatusText>}
              {eligMsg && <StatusText tone="success" className="msgBelow" role="status">{eligMsg}</StatusText>}
            </>
          )}
        </CollapsibleSection>

        {/* Claims registry — what each skill can honestly be called. Seeded on
            extraction, so it only exists once a CV is saved. */}
        {masterCvText && (
          <CollapsibleSection
            id="claims"
            icon="verified"
            title="Claims registry"
            open={openSections.has("claims")}
            onToggle={toggleSection}
            tone={claimsTotal === 0 ? "neutral" : claimsUnconfirmed > 0 ? "warn" : "ok"}
            summary={
              claimsTotal === 0
                ? "Seeded when your CV is extracted"
                : claimsUnconfirmed > 0
                  ? `${claimsTotal} skills — ${claimsUnconfirmed} to confirm`
                  : `${claimsTotal} skills confirmed`
            }
          >
            <p className="cvHelp">
              Tailoring may describe a skill only at the level you set here. <strong>Production</strong> = used in
              paid work; <strong>project</strong> = personal projects only (written as &quot;built X with it&quot;, never
              &quot;proficient in it&quot;); <strong>learning</strong> = never appears in any CV, letter or email. Click a
              skill to change its level. Figures in generated text are checked against your master CV automatically.
            </p>
            {!claims || claims.skills.length === 0 ? (
              <p className="cvHelp cvHelpTight">
                No skills registered yet — re-run extraction above to seed the list from your CV.
              </p>
            ) : (
              <>
                {claimsStale && (
                  <p className="fitEvidence">
                    Your CV changed since this list was seeded — re-run extraction above to refresh it. Levels you&apos;ve
                    confirmed are kept.
                  </p>
                )}
                <div className="claimLegend" aria-hidden="true">
                  <span className="claimChip production">production</span>
                  <span className="claimChip project">project</span>
                  <span className="claimChip learning">learning</span>
                  <span className="claimChip project unconfirmed">not confirmed yet</span>
                </div>
                <div className="stackChips claimChips" data-claims-list>
                  {claims.skills.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      className={"claimChip " + s.level + (s.confirmed ? "" : " unconfirmed")}
                      onClick={() => cycleLevel(s.name)}
                      title={`${s.level}${s.confirmed ? "" : " (not confirmed)"} — click to change`}
                      data-level={s.level}
                      data-confirmed={s.confirmed ? "1" : "0"}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="actions">
                  {unconfirmedCount > 0 ? (
                    <>
                      <Button onClick={handleConfirmClaims} disabled={claimsSaving || settingsMissing}>
                        {claimsSaving ? "Saving…" : `Confirm levels (${unconfirmedCount})`}
                      </Button>
                      <span className="cvSavedMeta">
                        Levels were read from your CV and are already enforced: a result that claims a skill above its level, or a
                        figure that isn&apos;t on your CV, blocks the download. Confirm once you&apos;ve reviewed them.
                      </span>
                    </>
                  ) : (
                    <span className="cvSavedLabel">
                      ✓ Levels reviewed — a figure that isn&apos;t on your CV, a learning skill in the output, or a project-only
                      skill written as work experience blocks the download until you fix it.
                    </span>
                  )}
                </div>
                <div className="actions">
                  <Button variant="ghost" onClick={() => setShowFigures((v) => !v)}>
                    {showFigures ? "Hide" : "Show"} the {figureKeys.length} figures the checker knows from your CV
                  </Button>
                </div>
                {showFigures && (
                  <div className="stackChips" style={{ marginTop: "var(--space-2)" }}>
                    {figureKeys.length === 0 ? (
                      <span className="fitEvidence">No quantified figures found in your CV.</span>
                    ) : (
                      figureKeys.map((k) => <span key={k} className="stackChip muted">{k}</span>)
                    )}
                  </div>
                )}
                {claimsError && <StatusText className="msgBelow" role="alert">{claimsError}</StatusText>}
                {claimsMsg && <StatusText tone="success" className="msgBelow" role="status">{claimsMsg}</StatusText>}
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Positioning variants — one headline + lead skills per role family,
            applied to the one master CV. Only meaningful once a CV exists. */}
        {masterCvText && (
          <CollapsibleSection
            id="variants"
            icon="target"
            title="Positioning"
            open={openSections.has("variants")}
            onToggle={toggleSection}
            summary={
              variantsDraft.length === 0
                ? "None — your CV's own positioning"
                : `${variantsDraft.length} variant${variantsDraft.length === 1 ? "" : "s"}`
            }
          >
            <p className="cvHelp">
              A headline naming two roles (&quot;Full Stack Engineer | AI Engineer&quot;) halves the impact of both. Set one
              positioning per kind of role: the summary opens with that headline and the skills section leads with those
              skills, drawn from your master CV as always. The pre-check picks the variant whose role types match the
              posting and says why; you can override it for any run.
            </p>
            {variantsColumnMissing && (
              <p className="fitEvidence">
                This feature&apos;s database column isn&apos;t set up yet (migration 20260917130000_user_settings_variants.sql).
                Variants can&apos;t be saved until it is.
              </p>
            )}
            {variantsDraft.map((v, idx) => (
              <div className="extractSummary" key={v.id} data-variant-row={idx}>
                <div className="profileGrid eligGrid">
                  <label>
                    Variant name
                    <Input value={v.name} onChange={(e) => updateVariant(v.id, { name: e.target.value })} placeholder="e.g. Backend" />
                  </label>
                  <label>
                    Headline (one positioning)
                    <Input value={v.headline} onChange={(e) => updateVariant(v.id, { headline: e.target.value })} placeholder="e.g. Backend engineer (Java, Spring Boot)" />
                  </label>
                  <label>
                    Lead with these skills (comma-separated, production-level on your claims registry)
                    <Input
                      value={leadSkillsText[v.id] ?? ""}
                      onChange={(e) => { const t = e.target.value; setLeadSkillsText((m) => ({ ...m, [v.id]: t })); setVariantsMsg(""); }}
                      placeholder="e.g. Java, Spring Boot, PostgreSQL"
                    />
                  </label>
                  {(() => {
                    const check = productionLeadSkills(splitList(leadSkillsText[v.id] ?? ""), claims);
                    return check.dropped.length > 0 ? (
                      <p className="fitEvidence" data-warn data-lead-skills-warn>
                        {leadSkillsNotice(check.dropped)}
                      </p>
                    ) : null;
                  })()}
                </div>
                <div className="eligChecks">
                  <span className="eligChecksLabel">Use for these kinds of role</span>
                  {ROLE_TYPES.map((t: RoleType) => (
                    <label key={t} className="eligCheck">
                      <input
                        type="checkbox"
                        checked={v.roleTypes.includes(t)}
                        onChange={(e) => {
                          const on = e.target.checked;
                          updateVariant(v.id, { roleTypes: on ? [...v.roleTypes.filter((x) => x !== t), t] : v.roleTypes.filter((x) => x !== t) });
                        }}
                      />
                      {ROLE_TYPE_LABEL[t]}
                    </label>
                  ))}
                </div>
                <div className="actions">
                  <Button variant="ghost" className="keyRemove" onClick={() => removeVariant(v.id)} disabled={variantsSaving}>
                    Remove variant
                  </Button>
                </div>
              </div>
            ))}
            <div className="actions">
              <Button variant="secondary" onClick={addVariant} disabled={variantsSaving || variantsDraft.length >= MAX_VARIANTS}>
                Add a variant
              </Button>
              <Button onClick={handleSaveVariants} disabled={variantsSaving || variantsColumnMissing}>
                {variantsSaving ? "Saving…" : "Save variants"}
              </Button>
            </div>
            {variantsError && <StatusText className="msgBelow" role="alert">{variantsError}</StatusText>}
            {variantsMsg && <StatusText tone="success" className="msgBelow" role="status">{variantsMsg}</StatusText>}
          </CollapsibleSection>
        )}

        <CollapsibleSection
          id="section-order"
          icon="list"
          title="Section order"
          open={openSections.has("section-order")}
          onToggle={toggleSection}
          summary={orderIsCustom ? "Custom order" : "Standard order"}
        >
          <FormField
            label="Section order"
            help="Drag a section, or use the arrows. This changes the order only — how many bullets each section gets is still decided by the tailoring for each specific job."
          >
          {loading ? (
            <Skeleton lines={5} label="Loading your layout" />
          ) : (
            <>
              <ul className="orderList">
                {order.map((id, index) => (
                  <li
                    key={id}
                    className={
                      "orderItem" +
                      (dragIndex === index ? " dragging" : "") +
                      (overIndex === index && dragIndex !== index ? " dropTarget" : "")
                    }
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      e.preventDefault(); // required for onDrop to fire
                      setOverIndex(index);
                    }}
                    onDragLeave={() => setOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) move(dragIndex, index);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  >
                    <span className="orderGrip" aria-hidden="true">⋮⋮</span>
                    <span className="orderNum">{index + 1}</span>
                    {/* The real CV heading style, so what's being reordered is
                        recognisably the same thing that appears on the CV. */}
                    <span className="cvHead orderHead">{SECTION_LABELS[id]}</span>
                    <span className="orderBtns">
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${SECTION_LABELS[id]} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index + 1)}
                        disabled={index === order.length - 1}
                        aria-label={`Move ${SECTION_LABELS[id]} down`}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save order"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setOrder([...DEFAULT_SECTION_ORDER]); setSavedMsg(""); }}
                  disabled={saving || isDefaultOrder(order)}
                >
                  Reset to standard
                </Button>
              </div>

              {error && <StatusText className="msgBelow" role="alert">{error}</StatusText>}
              {savedMsg && <StatusText tone="success" className="msgBelow" role="status">{savedMsg}</StatusText>}
            </>
          )}
          </FormField>
          {/* Was its own card headed "Not affected by this" — a whole card for
              one sentence about the card above it. It belongs here. */}
          <p className="cvHelp cvHelpTight cstFootnote">
            Not affected by this: your name and contact details stay at the top, and certifications and
            any extra sections from your CV stay after the sections above, in that order. Right to Work
            is a separate switch.
          </p>
        </CollapsibleSection>

        {/* CV length: two pages by default (lib/onePage fills them from the
            master CV), one page as an opt-in trim. Stored in
            user_settings.preferences.onePageCv. */}
        <CollapsibleSection
          id="cv-length"
          icon="document"
          title="CV length"
          open={openSections.has("cv-length")}
          onToggle={toggleSection}
          summary={prefs.onePageCv ? "One page" : "Two pages"}
        >
          <p className="cvHelp">
            Two pages is the default: the tailored CV keeps your master CV&apos;s content, and when the tailoring
            leaves a bullet out and there is room, the most relevant ones are put back so both pages are used. Choose
            one page only for a posting that asks for it — the least relevant bullets are then left out, and the
            results page lists every one.
          </p>
          {prefsColumnMissing && (
            <p className="fitEvidence">
              This setting&apos;s database column isn&apos;t set up yet (migration 20260918120000_user_settings_preferences.sql).
              The default — two pages — applies until it is.
            </p>
          )}
          <div className="eligChecks" role="radiogroup" aria-label="CV length">
            <label className="eligCheck">
              <input type="radio" name="cvLength" checked={!prefs.onePageCv} onChange={() => setCvLength(false)} data-pref-length="2" />
              Two pages — fill both with your strongest real content (recommended)
            </label>
            <label className="eligCheck">
              <input type="radio" name="cvLength" checked={prefs.onePageCv} onChange={() => setCvLength(true)} data-pref-length="1" />
              One page — trim the least relevant bullets to fit
            </label>
          </div>
          {prefsMsgAt === "length" && prefsMsg && <StatusText as="span" tone="success" role="status">{prefsMsg}</StatusText>}
          {prefsMsgAt === "length" && prefsError && <StatusText as="span" role="alert">{prefsError}</StatusText>}
        </CollapsibleSection>

        {/* Right to Work stays off the CV document by default: a reviewer who
            sees immigration status before any experience screens on it, and
            the form asks the question in a better context. The wording is
            kept and offered for forms; the cover letter is unchanged. */}
        <CollapsibleSection
          id="right-to-work"
          icon="globe"
          title="Right to Work"
          open={openSections.has("right-to-work")}
          onToggle={toggleSection}
          summary={prefs.includeRightToWorkOnCv ? "Shown on the CV" : "Off the CV — offered for forms"}
        >
          <p className="cvHelp">
            Off by default. A reviewer who sees your immigration status before reading a line of your experience
            screens on it, and the application form asks the same question in a better place. Your CV&apos;s wording
            stays saved: it is offered as a copy block beside the download buttons for pasting into forms, and the
            cover letter is unchanged. Turn it on only for a posting that asks for it on the document itself.
          </p>
          {profile && profile.rightToWork.length > 0 && (
            <p className="fitEvidence">Your CV says: {profile.rightToWork.join(" · ")}</p>
          )}
          {prefsColumnMissing && (
            <p className="fitEvidence">
              This setting&apos;s database column isn&apos;t set up yet (migration 20260918120000_user_settings_preferences.sql).
              The default — off — applies until it is.
            </p>
          )}
          <div className="eligChecks">
            <label className="eligCheck">
              <input
                type="checkbox"
                checked={prefs.includeRightToWorkOnCv}
                onChange={(e) => toggleRightToWorkOnCv(e.target.checked)}
                data-pref-rtw
              />
              Include Right to Work on the CV
            </label>
          </div>
          {prefsMsgAt === "rtw" && prefsMsg && <StatusText as="span" tone="success" role="status">{prefsMsg}</StatusText>}
          {prefsMsgAt === "rtw" && prefsError && <StatusText as="span" role="alert">{prefsError}</StatusText>}
        </CollapsibleSection>

        {/* Advanced customization — the full project pool. Only meaningful
            once a master CV exists (the pool augments it, and the DB write is
            an update against that row). */}
        {masterCvText && (
          <CollapsibleSection
            id="advanced"
            icon="sliders"
            title="Project pool"
            open={openSections.has("advanced")}
            onToggle={toggleSection}
            summary={
              poolLength > 0
                ? `${poolLength.toLocaleString()} characters saved`
                : "Not set — tailoring uses your CV's projects"
            }
          >
            {/* No inner "Advanced customization" button any more: the section
                header IS the disclosure, and a disclosure inside a disclosure
                made the user click twice to reach one textarea. */}
            <FormField
                label="Project pool"
                help="Paste ALL your projects here, in your own words — names, dates, tech, and what you did. On every tailor run the 2 most relevant to that job (1 if you only add one) are selected and get tailored bullets, replacing the projects from your master CV for that run. Remove the pool to switch back. Replacing your master CV also deletes the pool."
              >
                <Textarea
                  rows={12}
                  value={poolDraft}
                  onChange={(e) => { setPoolDraft(e.target.value); setPoolMsg(""); setPoolError(""); }}
                  placeholder={"Project name | Jan 2025\nTech: React, Node.js, PostgreSQL\n- What you built and the outcome\n\nNext project…"}
                  disabled={poolSaving}
                />
                <p className="charCount">
                  {poolDraft.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()}
                </p>
                <div className="actions">
                  <Button onClick={() => handleSavePool(false)} disabled={poolSaving}>
                    {poolSaving ? "Saving…" : "Save project pool"}
                  </Button>
                  {poolSaved && (
                    <Button variant="ghost" className="keyRemove" onClick={() => handleSavePool(true)} disabled={poolSaving}>
                      Remove pool
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => toggleSection("advanced")} disabled={poolSaving}>
                    Close
                  </Button>
                </div>
                {poolError && <StatusText className="msgBelow" role="alert">{poolError}</StatusText>}
                {poolMsg && <StatusText tone="success" className="msgBelow" role="status">{poolMsg}</StatusText>}
            </FormField>
          </CollapsibleSection>
        )}
          </div>
        </div>
      </div>
    </main>
  );
}
