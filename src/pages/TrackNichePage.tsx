import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type Submission, type TrackedNiche } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export function TrackNichePage() {
  const { id: submissionId } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [existing, setExisting] = useState<TrackedNiche | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    load();
  }, [submissionId]);

  async function load() {
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
    if (subError) setError(subError.message);
    else setSubmission(sub as Submission);
    setExisting((tracked as TrackedNiche) ?? null);
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

      <span className="eyebrow">Continuous watch</span>
      <h1 style={{ margin: "0.75rem 0 1rem", fontSize: "1.6rem", lineHeight: 1.25 }}>
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

      {existing ? (
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
