// CV storage layer — backed by Supabase (master_cvs + cv_profiles tables).
// All functions are async. Names are unchanged; callsites only need `await`.
// All calls use the browser client: this file is only ever imported from
// 'use client' components, so the JWT in the browser cookie store is always
// available and RLS works automatically.

import { createClient } from '@/lib/supabase/client'

export type MasterCV = {
  text: string       // full CV text
  updatedAt: number  // milliseconds since epoch
  // Advanced customization: the user's full project pool (free text), or null
  // when unset / the projects_pool migration hasn't been applied yet.
  projectsPool: string | null
}

// The profile shape and its normaliser live in @/lib/profile (shared with the
// server routes, which must not import the browser client from this file).
export type { Education, ProjectLink, CvProject, ExtraSection, Profile } from '@/lib/profile'
import { normalizeProfile, type Profile } from '@/lib/profile'
import { normalizeEligibility, type Eligibility } from '@/lib/knockouts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  // getSession() reads from the browser cookie store — no network call.
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}

// ─── Master CV ────────────────────────────────────────────────────────────────

export async function getMasterCV(): Promise<MasterCV | null> {
  try {
    const supabase = createClient()
    let { data, error } = await supabase
      .from('master_cvs')
      .select('text, updated_at, projects_pool')
      .maybeSingle()            // returns null (not error) when 0 rows exist
    if (error?.code === '42703') {
      // projects_pool migration not applied — retry without the column so a
      // missing pool can never take the whole master CV down with it.
      ;({ data, error } = await supabase
        .from('master_cvs')
        .select('text, updated_at')
        .maybeSingle())
    }
    if (error || !data) return null
    const pool = (data as { projects_pool?: unknown }).projects_pool
    return {
      text: data.text,
      updatedAt: new Date(data.updated_at).getTime(),
      projectsPool: typeof pool === 'string' && pool.trim() ? pool : null,
    }
  } catch {
    return null
  }
}

// Returns the saved record, or null when the write did NOT happen (signed
// out, RLS refusal, network). Callers must treat null as a failure and say
// so — a previous version returned an optimistic record on every path, which
// let the Customize page show "Saved" for a CV that was never persisted.
export async function saveMasterCV(text: string): Promise<MasterCV | null> {
  const trimmed = text.trim()
  try {
    const userId = await getUserId()
    if (!userId) return null

    const supabase = createClient()
    const { data, error } = await supabase
      .from('master_cvs')
      .upsert(
        { user_id: userId, text: trimmed, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }   // user_id has a UNIQUE constraint
      )
      .select('text, updated_at')
      .single()

    if (error || !data) {
      if (error) console.error('master_cvs upsert error:', error.message)
      return null
    }
    // The upsert never sends projects_pool, so an existing pool survives CV
    // edits — but this result doesn't read it back. Take the pool from
    // getMasterCV() on load, never from a save result.
    return { text: data.text, updatedAt: new Date(data.updated_at).getTime(), projectsPool: null }
  } catch (err) {
    console.error('master_cvs upsert error:', err instanceof Error ? err.message : 'Unknown error')
    return null
  }
}

// Advanced customization: save (or clear, with '') the user's project pool.
// An update, not an upsert — a pool without a master CV row is meaningless,
// and the /customize panel only renders once a CV is saved.
export async function saveProjectsPool(
  pool: string
): Promise<{ ok: boolean; missingColumn?: boolean }> {
  try {
    const userId = await getUserId()
    if (!userId) return { ok: false }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('master_cvs')
      .update({ projects_pool: pool.trim() || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id')

    if (error) {
      // PGRST204: the projects_pool column doesn't exist yet — the migration
      // hasn't been applied. Surface that specifically so the UI can say so.
      if (error.code === 'PGRST204') return { ok: false, missingColumn: true }
      console.error('projects_pool update error:', error.message)
      return { ok: false }
    }
    // Zero rows updated = no master CV row (or RLS refusal) — not a save.
    return { ok: Array.isArray(data) && data.length > 0 }
  } catch (err) {
    console.error('projects_pool update error:', err instanceof Error ? err.message : 'Unknown error')
    return { ok: false }
  }
}

// ─── User settings (Brief 2: eligibility profile + claims registry) ──────────
//
// One row per user in user_settings (migration 20260917120000). Both values
// are sent along in request bodies by the pages that hold them - the server
// reads no per-user tables for these, same as projects_pool. Until the
// migration is applied the table is missing (PGRST205): reads answer nulls
// with missingTable so the panels can name the fix; writes report it too.

export type UserSettings = {
  eligibility: Eligibility | null
  // Normalized by lib/claims (the registry's own module) at the call site.
  claims: unknown
  // Normalized by lib/variants at the call site. Column added by migration
  // 20260917130000; reads retry without it.
  variants: unknown
  // Normalized by lib/preferences at the call site. Column added by migration
  // 20260918120000; reads retry without it (defaults apply).
  preferences: unknown
  missingTable: boolean
  variantsColumnMissing: boolean
  preferencesColumnMissing: boolean
}

function isMissingTable(code: string | undefined): boolean {
  return code === 'PGRST205' || code === '42P01'
}

export async function getUserSettings(): Promise<UserSettings> {
  const empty: UserSettings = {
    eligibility: null, claims: null, variants: null, preferences: null,
    missingTable: false, variantsColumnMissing: false, preferencesColumnMissing: false,
  }
  try {
    const supabase = createClient()
    // Column ladder, newest optional column first: each rung names the
    // migration it lacks and the rest keep working.
    const rungs: { columns: string; variantsMissing: boolean; preferencesMissing: boolean }[] = [
      { columns: 'eligibility, claims, variants, preferences', variantsMissing: false, preferencesMissing: false },
      { columns: 'eligibility, claims, variants', variantsMissing: false, preferencesMissing: true },
      { columns: 'eligibility, claims', variantsMissing: true, preferencesMissing: true },
    ]
    let data: unknown = null
    let error: { code?: string; message: string } | null = null
    let rung = rungs[0]
    for (const r of rungs) {
      rung = r
      ;({ data, error } = await supabase.from('user_settings').select(r.columns).maybeSingle())
      if (error?.code !== '42703') break
    }
    const variantsColumnMissing = rung.variantsMissing
    const preferencesColumnMissing = rung.preferencesMissing
    if (error) {
      if (isMissingTable(error.code)) return { ...empty, missingTable: true }
      console.error('user_settings read error:', error.message)
      return empty
    }
    if (!data) return { ...empty, variantsColumnMissing, preferencesColumnMissing }
    const row = data as { eligibility?: unknown; claims?: unknown; variants?: unknown; preferences?: unknown }
    return {
      eligibility: row.eligibility ? normalizeEligibility(row.eligibility) : null,
      claims: row.claims ?? null,
      variants: row.variants ?? null,
      preferences: row.preferences ?? null,
      missingTable: false,
      variantsColumnMissing,
      preferencesColumnMissing,
    }
  } catch (err) {
    console.error('user_settings read error:', err instanceof Error ? err.message : 'Unknown error')
    return empty
  }
}

async function upsertUserSettings(
  patch: { eligibility?: Eligibility | null; claims?: unknown; variants?: unknown; preferences?: unknown }
): Promise<{ ok: boolean; missingTable?: boolean; missingColumn?: boolean }> {
  try {
    const userId = await getUserId()
    if (!userId) return { ok: false }
    const supabase = createClient()
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) {
      if (isMissingTable(error.code)) return { ok: false, missingTable: true }
      if (error.code === 'PGRST204') return { ok: false, missingColumn: true }
      console.error('user_settings write error:', error.message)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('user_settings write error:', err instanceof Error ? err.message : 'Unknown error')
    return { ok: false }
  }
}

export function saveEligibility(eligibility: Eligibility): Promise<{ ok: boolean; missingTable?: boolean }> {
  return upsertUserSettings({ eligibility: { ...normalizeEligibility(eligibility), updatedAt: new Date().toISOString() } })
}

// null clears the registry (a replaced master CV starts a fresh one).
export function saveClaims(claims: unknown | null): Promise<{ ok: boolean; missingTable?: boolean }> {
  return upsertUserSettings({ claims })
}

export function saveVariants(variants: unknown | null): Promise<{ ok: boolean; missingTable?: boolean; missingColumn?: boolean }> {
  return upsertUserSettings({ variants })
}

// Document preferences (lib/preferences). Always written whole.
export function savePreferences(preferences: unknown): Promise<{ ok: boolean; missingTable?: boolean; missingColumn?: boolean }> {
  return upsertUserSettings({ preferences })
}

export async function clearMasterCV(): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return
    const supabase = createClient()
    await supabase.from('master_cvs').delete().eq('user_id', userId)
  } catch { /* ignore */ }
}

export async function hasMasterCV(): Promise<boolean> {
  return (await getMasterCV()) !== null
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<Profile | null> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cv_profiles')
      .select('data')
      .maybeSingle()
    if (error || !data || !data.data) return null
    // Profiles saved before normalisation existed may carry model-shaped
    // surprises; coerce on the way out so every consumer sees the real shape.
    return normalizeProfile(data.data)
  } catch {
    return null
  }
}

// True when the write happened. False = not persisted; the caller decides
// whether that needs surfacing (it does for a user-initiated save).
export async function saveProfile(profile: Profile): Promise<boolean> {
  try {
    const userId = await getUserId()
    if (!userId) return false
    const supabase = createClient()
    const { error } = await supabase
      .from('cv_profiles')
      .upsert(
        { user_id: userId, data: profile, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    if (error) {
      console.error('cv_profiles upsert error:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('cv_profiles upsert error:', err instanceof Error ? err.message : 'Unknown error')
    return false
  }
}

export async function clearProfile(): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return
    const supabase = createClient()
    await supabase.from('cv_profiles').delete().eq('user_id', userId)
  } catch { /* ignore */ }
}

// ─── One-time localStorage import ────────────────────────────────────────────
// Called on first load after login. If the DB has no CV but localStorage does,
// migrate it to the database so existing users don't lose their CV.

const LS_CV_KEY      = 'cvtailor_master_cv'
const LS_PROFILE_KEY = 'cvtailor_profile'

export async function importFromLocalStorageIfNeeded(): Promise<MasterCV | null> {
  if (typeof window === 'undefined') return null
  try {
    const rawCv = window.localStorage.getItem(LS_CV_KEY)
    if (!rawCv) return null
    const parsed = JSON.parse(rawCv) as { text: string; updatedAt: number }
    if (!parsed?.text) return null

    // Save CV to DB. If that fails, leave localStorage alone so the import
    // is retried next time rather than the CV being lost.
    const saved = await saveMasterCV(parsed.text)
    if (!saved) return null

    // Also migrate profile if present
    const rawProfile = window.localStorage.getItem(LS_PROFILE_KEY)
    if (rawProfile) {
      await saveProfile(normalizeProfile(JSON.parse(rawProfile)))
    }

    // Clear localStorage after successful import so we never re-import
    window.localStorage.removeItem(LS_CV_KEY)
    window.localStorage.removeItem(LS_PROFILE_KEY)

    return saved
  } catch {
    return null
  }
}
