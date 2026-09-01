// CV storage layer — backed by Supabase (master_cvs + cv_profiles tables).
// All functions are async. Names are unchanged; callsites only need `await`.
// All calls use the browser client: this file is only ever imported from
// 'use client' components, so the JWT in the browser cookie store is always
// available and RLS works automatically.

import { createClient } from '@/lib/supabase/client'

export type MasterCV = {
  text: string       // full CV text
  updatedAt: number  // milliseconds since epoch
}

// The profile shape and its normaliser live in @/lib/profile (shared with the
// server routes, which must not import the browser client from this file).
export type { Education, ProjectLink, CvProject, ExtraSection, Profile } from '@/lib/profile'
import { normalizeProfile, type Profile } from '@/lib/profile'

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
    const { data, error } = await supabase
      .from('master_cvs')
      .select('text, updated_at')
      .maybeSingle()            // returns null (not error) when 0 rows exist
    if (error || !data) return null
    return { text: data.text, updatedAt: new Date(data.updated_at).getTime() }
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
    return { text: data.text, updatedAt: new Date(data.updated_at).getTime() }
  } catch (err) {
    console.error('master_cvs upsert error:', err instanceof Error ? err.message : 'Unknown error')
    return null
  }
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
