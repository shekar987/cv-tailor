// Supabase Edge Function: agent-artifact-sign (Chunk 35).
//
// The Local Agent worker (on the user's PC) has no Supabase session, so it
// cannot write the private `agent-artifacts` bucket directly. It POSTs its
// device token here; this function — which DOES hold the privileged key, kept
// as a Supabase secret, never on the PC — validates the token against the job
// with the `agent_artifact_target` RPC and returns a short-lived signed upload
// URL for `<user_id>/<job_id>/<filename>`. The worker then PUTs the screenshot
// bytes straight to that URL. No service-role key ever reaches the worker.
//
// Deploy (owner, once):
//   supabase functions deploy agent-artifact-sign --no-verify-jwt
//   supabase secrets set AGENT_SUPABASE_URL=... AGENT_SERVICE_ROLE_KEY=...
// Then set the worker's AGENT__ARTIFACT_SIGN_URL (agent/.env `ARTIFACT_SIGN_URL`)
// to this function's URL. `--no-verify-jwt` is required: the caller is the
// worker with a device token, not a signed-in user — the token is the check.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const BUCKET = "agent-artifacts";
// Only these extensions — the worker uploads a PNG; JSON is allowed for a
// possible future observer dump. No path separators, no traversal.
const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,120}\.(png|jpg|jpeg|webp|json)$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("AGENT_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey =
    Deno.env.get("AGENT_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "function_not_configured" }, 500);

  let body: { device_token?: string; job_id?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const deviceToken = (body.device_token ?? "").trim();
  const jobId = (body.job_id ?? "").trim();
  const filename = (body.filename ?? "").trim();
  if (!deviceToken || !jobId) return json({ error: "missing_token_or_job" }, 400);
  if (!SAFE_FILENAME.test(filename)) return json({ error: "bad_filename" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Validate the token against the job; returns the owning user_id or null.
  const { data: userId, error: rpcError } = await admin.rpc("agent_artifact_target", {
    p_device_token: deviceToken,
    p_job_id: jobId,
  });
  if (rpcError) return json({ error: "verify_failed" }, 500);
  if (!userId || typeof userId !== "string") return json({ error: "invalid_device_or_job" }, 403);

  const path = `${userId}/${jobId}/${filename}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return json({ error: "sign_failed" }, 500);

  // Hand the worker an absolute PUT target. `data.signedUrl` is a relative
  // storage path; `data.token` is the upload token. Build the explicit
  // upload-to-signed-url endpoint so a plain HTTP PUT works.
  const uploadUrl =
    `${url.replace(/\/$/, "")}/storage/v1/object/upload/sign/${BUCKET}/${encodeURI(path)}?token=${data.token}`;

  return json({ ok: true, path, upload_url: uploadUrl, signed_url: data.signedUrl });
});
