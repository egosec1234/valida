import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  supabase,
  type NicheUpdate,
  type Submission,
  type TrackedNiche,
} from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export function TrackNichePage() {
  const { id: submissionId } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [existing, setExisting] = useState<TrackedNiche | null>(null);
  const [updates, setUpdates] = useState<NicheUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // isCancelled lets a quick navigation to a different tracked niche (before
  // this load finishes) skip its own stale setState calls, instead of
  // overwriting the newer page with this one's slower response.
  async function load(isCancelled: () => boolean) {
    setLoading(true);
    setError(null);
    const [{ data: sub, error: subError }, { data: tracked }] = await Promise.all([
      supabase.from("submissions").select("*").eq("id", submissionId).single(),
      supabase
        .from("tracked_niches")
        .select("*")
        .eq("submission_id", submissionId)
        .maybeSingle(),
    ]);
    if (isCancelled()) return;

    if (subError) setError(subError.message);
    else setSubmission(sub as Submission);

    const trackedNiche = (tracked as TrackedNiche) ?? null;
    setExisting(trackedNiche);

    if (trackedNiche?.status === "active") {
      const { data: updateRows } = await supabase
        .from("niche_updates")
        .select("*")
        .eq("tracked_niche_id", trackedNiche.id)
        .order("created_at", { ascending: false });
      if (isCancelled()) return;
      setUpdates((updateRows as NicheUpdate[]) ?? []);
    }

    setLoading(false);
  }

  async function handleJoinWaitlist() {
    if (!submission || !user) return;
    setJoining(true);
    setError(null);

    const { data, error } = await supabase
      .from("tracked_niches")
      .insert({
        user_id: user.id,
        submission_id: submission.id,
        niche: submission.niche,
        status: "pending_upgrade",
      })
      .select()
      .single();

    setJoining(false);

    if (error) {
      // 23505 = unique_violation - a double-click (or a second tab) already
      // created this row. Treat it as success: fetch and show the existing
      // entry instead of surfacing an error for something that isn't one.
      if (error.code === "23505") {
        const { data: existingRow } = await supabase
          .from("tracked_niches")
          .select("*")
          .eq("submission_id", submission.id)
          .single();
        if (existingRow) setExisting(existingRow as TrackedNiche);
        return;
      }
      setError(error.message);
      return;
    }
    setExisting(data as TrackedNiche);
  }

  if (loading) return <p className="page-loading">Loading...</p>;
  if (error && !submission) {
    return (
      <div className="page">
        <p className="form-error">{error}</p>
        <Link to="/history" className="back-link">
          &larr; Back to history
        </Link>
      </div>
    );
  }
  if (!submission) return null;

  return (
    <div className="page">
      <Link to={`/results/${submission.id}`} className="back-link">
        &larr; Back to results
      </Link>

      <h1 style={{ margin: "0 0 1rem", fontSize: "1.6rem", lineHeight: 1.25 }}>
        Don't get blindsided after you've already started building.
      </h1>
      <p className="idea-text" style={{ fontSize: "0.98rem", color: "var(--ink-muted)" }}>
        Your free score is a snapshot from today. A new competitor can show up,
        or the ones you already found can raise money and pull ahead, weeks
        after you stopped looking. Weekly monitoring keeps watching{" "}
        <strong style={{ color: "var(--ink)" }}>
          {submission.niche || "this niche"}
        </strong>{" "}
        for you.
      </p>

      <div className="section-label" style={{ marginTop: "2rem" }}>
        What continuous watch includes
      </div>
      <ul className="spec-list">
        <li>Weekly re-scan of your niche for new competitors</li>
        <li>An email the moment something changes that actually matters</li>
        <li>A running history of your market over time, instead of a single snapshot</li>
      </ul>

      {existing?.status === "active" ? (
        <>
          <div className="panel upsell-panel">
            <span className="status-pill status-active">Monitoring active</span>
            <p style={{ marginTop: "0.85rem", marginBottom: 0 }}>
              We check this niche weekly and email you when something worth
              knowing changes.
            </p>
          </div>

          <div className="section-label" style={{ marginTop: "2rem" }}>
            Update history
          </div>
          {updates.length === 0 ? (
            <p className="empty-note">
              No checks yet. The first one runs on the next weekly cycle.
            </p>
          ) : (
            <ul className="data-list">
              {updates.map((update) => (
                <li key={update.id} className="data-row">
                  <span className="data-row-index">
                    {new Date(update.created_at).toLocaleDateString()}
                  </span>
                  <span>
                    <span className={`status-pill status-${update.status}`}>
                      {update.status === "processing" && "Checking for changes"}
                      {update.status === "failed" && "Didn't complete"}
                      {update.status === "complete" &&
                        (update.has_meaningful_changes ? "Something changed" : "No major changes")}
                    </span>
                    {update.status === "complete" && (
                      <>
                        {update.summary && (
                          <div className="data-row-detail">{update.summary}</div>
                        )}
                        {update.notable_changes.map((change, i) => (
                          <div className="data-row-detail" key={i}>
                            <strong style={{ color: "var(--ink)" }}>
                              {change.change}:
                            </strong>{" "}
                            {change.detail}
                          </div>
                        ))}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : existing ? (
        <div className="panel upsell-panel">
          <span className="status-pill status-pending_upgrade">On the list</span>
          <p style={{ marginTop: "0.85rem", marginBottom: 0 }}>
            We'll email you as soon as weekly monitoring is live for this niche.
          </p>
        </div>
      ) : (
        <div className="panel">
          <p className="panel-subhead" style={{ marginBottom: "1.1rem" }}>
            Pricing isn't final yet. Join the waitlist and we'll notify you at
            launch.
          </p>
          {error && <p className="form-error">{error}</p>}
          <button onClick={handleJoinWaitlist} disabled={joining}>
            {joining ? "Joining..." : "Notify me when this launches"}
          </button>
        </div>
      )}
    </div>
  );
}
