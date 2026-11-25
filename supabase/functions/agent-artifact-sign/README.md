# agent-artifact-sign (Chunk 35)

Mints a short-lived **signed upload URL** so the Local Agent worker can store a
job's full-page screenshot in the private `agent-artifacts` bucket without ever
holding a privileged Supabase key on the user's PC.

The worker POSTs `{ device_token, job_id, filename }`. This function validates
the token against the job with the `agent_artifact_target` RPC (migration
`20261121120000_agent_artifacts.sql`), then returns
`{ ok, path, upload_url }` for `<user_id>/<job_id>/<filename>`. The worker PUTs
the PNG straight to `upload_url`. The service-role key lives only here, as a
Supabase secret.

## Deploy (owner, once)

```bash
# 1. Apply the migration in the Supabase SQL editor:
#    supabase/migrations/20261121120000_agent_artifacts.sql

# 2. Deploy the function. --no-verify-jwt: the caller is the worker with a
#    device token, not a signed-in user — the token is the check.
supabase functions deploy agent-artifact-sign --no-verify-jwt

# 3. Give it the service role (kept off the PC). The built-in SUPABASE_URL /
#    SUPABASE_SERVICE_ROLE_KEY are also read if these are unset.
supabase secrets set AGENT_SUPABASE_URL="https://<ref>.supabase.co"
supabase secrets set AGENT_SERVICE_ROLE_KEY="<service-role key>"
```

Then set the worker's `ARTIFACT_SIGN_URL` (in `agent/.env`) to the function URL,
e.g. `https://<ref>.supabase.co/functions/v1/agent-artifact-sign`.

Without any of this the worker still reads every page and records the field
list — only the screenshot upload is skipped, noted on the job.
