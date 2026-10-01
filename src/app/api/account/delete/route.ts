import { NextRequest, NextResponse } from "next/server";
import { signedIn, unauthorized, readJsonBody, invalidBody } from "@/lib/routeAuth";
import { SENT_CV_BUCKET } from "@/lib/sentCv";
import { DELETE_CONFIRM_PHRASE as CONFIRM_PHRASE } from "@/lib/account";

// POST /api/account/delete { confirm: "delete my account" } — the signed-in
// user deletes their own account: every uploaded file (Storage API, as the
// user), then the SECURITY DEFINER RPC delete_own_account() removes the auth
// row and every table cascades (migration 20261001130000). No admin key is
// read anywhere in src/ — the RPC can only ever delete auth.uid(). The typed
// phrase is checked here as well as in the page so a stray POST cannot do it.

const MIGRATION = "supabase/migrations/20261001130000_delete_own_account.sql";

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return unauthorized();
    const { supabase, userId } = caller;

    const body = await readJsonBody(req);
    if (!body) return invalidBody();
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== CONFIRM_PHRASE) {
      return NextResponse.json({ error: `Type "${CONFIRM_PHRASE}" to confirm.` }, { status: 400 });
    }

    // The CV files the user uploaded: <user>/<application>/<file>. The
    // Storage list is one level at a time. A listing or removal failure
    // stops here — the files must not outlive the account.
    const store = supabase.storage.from(SENT_CV_BUCKET);
    const { data: folders, error: listError } = await store.list(userId, { limit: 1000 });
    if (listError && !/not found/i.test(listError.message)) {
      console.error("account delete: list error:", listError.message);
      return NextResponse.json({ error: "Could not remove your uploaded files. Nothing was deleted." }, { status: 500 });
    }
    const paths: string[] = [];
    for (const folder of folders ?? []) {
      const { data: files, error: innerError } = await store.list(`${userId}/${folder.name}`, { limit: 1000 });
      if (innerError) {
        console.error("account delete: list error:", innerError.message);
        return NextResponse.json({ error: "Could not remove your uploaded files. Nothing was deleted." }, { status: 500 });
      }
      for (const f of files ?? []) if (f.id) paths.push(`${userId}/${folder.name}/${f.name}`);
    }
    if (paths.length) {
      const { error: removeError } = await store.remove(paths);
      if (removeError) {
        console.error("account delete: remove error:", removeError.message);
        return NextResponse.json({ error: "Could not remove your uploaded files. Nothing was deleted." }, { status: 500 });
      }
    }

    const { error: rpcError } = await supabase.rpc("delete_own_account");
    if (rpcError) {
      if (rpcError.code === "PGRST202") {
        return NextResponse.json(
          { error: `Account deletion is not set up on this database yet (missing ${MIGRATION}).`, errorType: "needs_migration" },
          { status: 503 }
        );
      }
      console.error("account delete: rpc error:", rpcError.message);
      return NextResponse.json({ error: "Could not delete your account. Your data is unchanged; try again." }, { status: 500 });
    }

    // The session cookie now names a user that no longer exists; clear it.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.json({ ok: true, filesRemoved: paths.length });
  } catch (err) {
    console.error("account delete error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not delete your account" }, { status: 500 });
  }
}
