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

export type Education    = { degree: string; dates: string; institution: string; note: string }
export type ProjectLink  = { label: string; url: string; text: string }
export type CvProject    = { name: string; tech: string; links: ProjectLink[]; originalBullets: string[] }
export type Profile = {
  name: string; tagline: string; location: string; phone: string
  email: string; linkedin: string; github: string
  education: Education[]; certifications: string[]
  projects: CvProject[]; rightToWork: string[]
}

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

export async function saveMasterCV(text: string): Promise<MasterCV> {
  const trimmed = text.trim()
  const optimistic: MasterCV = { text: trimmed, updatedAt: Date.now() }
  try {
    const userId = await getUserId()
    if (!userId) return optimistic  // not signed in — UI still works, just not persisted

    const supabase = createClient()
    const { data, error } = await supabase
      .from('master_cvs')
      .upsert(
        { user_id: userId, text: trimmed, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }   // user_id has a UNIQUE constraint
      )
      .select('text, updated_at')
      .single()

    if (error || !data) return optimistic
    return { text: data.text, updatedAt: new Date(data.updated_at).getTime() }
  } catch {
    return optimistic
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
    if (error || !data) return null
    return data.data as Profile
  } catch {
    return null
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return
    const supabase = createClient()
    await supabase
      .from('cv_profiles')
      .upsert(
        { user_id: userId, data: profile, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
  } catch { /* ignore */ }
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

    // Save CV to DB
    const saved = await saveMasterCV(parsed.text)

    // Also migrate profile if present
    const rawProfile = window.localStorage.getItem(LS_PROFILE_KEY)
    if (rawProfile) {
      const profile = JSON.parse(rawProfile) as Profile
      await saveProfile(profile)
    }

    // Clear localStorage after successful import so we never re-import
    window.localStorage.removeItem(LS_CV_KEY)
    window.localStorage.removeItem(LS_PROFILE_KEY)

    return saved
  } catch {
    return null
  }
}
