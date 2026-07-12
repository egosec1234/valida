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
      <div className="track-page">
        <p className="form-error">{error}</p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }
  if (!submission) return null;

  return (
    <div className="track-page">
      <Link to={`/results/${submission.id}`} className="back-link">
        &larr; Back to results
      </Link>

      <span className="pill pill-highlight">Weekly Niche Monitoring</span>
      <h1>Don't get blindsided after you've already started building.</h1>
      <p className="track-subhead">
        Your free score is a snapshot from today. Markets move — a new competitor,
        a funding round, or a shift in demand can change everything a few weeks in.
        Weekly monitoring keeps watch on{" "}
        <strong>{submission.niche || "this niche"}</strong> for you, automatically.
      </p>

      <ul className="track-benefits">
        <li>Weekly re-scan of your niche for new competitors and market signals</li>
        <li>An email alert the moment something material changes</li>
        <li>A running history of how your market is evolving, not just one snapshot</li>
      </ul>

      {existing ? (
        <div className="track-confirmed">
          <p>
            <strong>You're on the list.</strong> We'll email you as soon as weekly
            monitoring is live for this niche.
          </p>
        </div>
      ) : (
        <div className="track-cta-box">
          <p className="track-price-note">
            Pricing isn't final yet — join the waitlist and we'll notify you at launch.
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
