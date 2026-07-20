// Supabase Edge Function: delete-account
// Permanently deletes the requesting user's data and their auth account.
// Requires the service-role key (auto-injected by the platform) since
// deleting an auth user is an admin-only operation.
//
// Deploy: supabase functions deploy delete-account

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // Scoped client to identify the caller from their own JWT.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // Admin client (service-role) to delete data across RLS and remove the
    // auth user itself - both are admin-only operations.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // submissions.user_id has no ON DELETE CASCADE from auth.users, so it
    // must be cleaned up explicitly or it's orphaned once the user is gone.
    // tracked_niches cascades from both auth.users and submissions, but is
    // deleted explicitly too rather than relying on that chain.
    const { error: trackedError } = await admin
      .from("tracked_niches")
      .delete()
      .eq("user_id", user.id);
    if (trackedError) {
      return json({ error: `Failed to delete tracked niches: ${trackedError.message}` }, 500);
    }

    const { error: submissionsError } = await admin
      .from("submissions")
      .delete()
      .eq("user_id", user.id);
    if (submissionsError) {
      return json({ error: `Failed to delete submissions: ${submissionsError.message}` }, 500);
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return json({ error: deleteUserError.message }, 500);
    }

    return json({ deleted: true });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
