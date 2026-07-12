import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type Submission } from "../lib/supabaseClient";

const POLL_INTERVAL_MS = 3000;
// If a submission is still "processing" after this long, the background
// worker most likely died mid-run (e.g. hit the platform's wall-clock cap)
// with no chance to mark itself failed - surface that instead of polling forever.
const STALE_AFTER_MS = 3 * 60 * 1000;

export function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollStartedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!id) return;
    pollStartedAt.current = Date.now();

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function fetchOnce() {
      const { data, error } = await supabase
        .from("submissions")
        .select("*")
        .eq("id", id)
        .single();

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setSubmission(data as Submission);
      setLoading(false);

      if (data.status === "processing") {
        timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
      }
    }

    fetchOnce();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (loading) return <p className="page-loading">Loading...</p>;
  if (error || !submission) {
    return (
      <div className="result-page">
        <p className="form-error">{error ?? "Submission not found."}</p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }

  if (submission.status === "processing") {
    const isStale = Date.now() - pollStartedAt.current > STALE_AFTER_MS;
    return (
      <div className="result-page">
        <Link to="/" className="back-link">
          &larr; Back to dashboard
        </Link>
        <h1>Researching your idea...</h1>
        <p className="idea-text">{submission.idea_text}</p>
        {submission.niche && <p className="niche-tag">Niche: {submission.niche}</p>}
        {isStale ? (
          <p className="form-error">
            This is taking much longer than usual and may have failed silently.
            Feel free to keep waiting, or submit a new idea from the dashboard.
          </p>
        ) : (
          <p>This usually takes under a minute. This page updates automatically.</p>
        )}
      </div>
    );
  }

  if (submission.status === "failed") {
    return (
      <div className="result-page">
        <Link to="/" className="back-link">
          &larr; Back to dashboard
        </Link>
        <h1>Something went wrong</h1>
        <p className="idea-text">{submission.idea_text}</p>
        <p className="form-error">
          {submission.error_message ?? "The research task failed unexpectedly."}
        </p>
      </div>
    );
  }

  const report = submission.report;

  return (
    <div className="result-page">
      <Link to="/" className="back-link">
        &larr; Back to dashboard
      </Link>
      <h1>Your free score</h1>
      <p className="idea-text">{submission.idea_text}</p>
      {submission.niche && <p className="niche-tag">Niche: {submission.niche}</p>}

      {!report ? (
        <p>No report available.</p>
      ) : (
        <>
          <div className="score-badge">{report.score}/100</div>

          <section>
            <h2>Summary</h2>
            <p>{report.summary}</p>
          </section>

          <section>
            <h2>Key risks</h2>
            <ul>
              {report.risks.map((risk, i) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Competitors</h2>
            <ul>
              {report.competitors.map((c, i) => (
                <li key={i}>
                  <strong>{c.name}</strong> — {c.description}
                  {c.url && (
                    <>
                      {" "}
                      (
                      <a href={c.url} target="_blank" rel="noreferrer">
                        link
                      </a>
                      )
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Recommendation</h2>
            <p>{report.recommendation}</p>
          </section>

          <section className="track-upsell">
            <span className="pill pill-highlight">Next step</span>
            <h2 className="upsell-heading">This score is a snapshot from today</h2>
            <p>
              Competitors and markets shift week to week. Get weekly monitoring on{" "}
              {submission.niche ? <strong>{submission.niche}</strong> : "this niche"}{" "}
              so you find out the moment something changes — not months later.
            </p>
            <Link to={`/track/${submission.id}`} className="button-link">
              Track this niche weekly &rarr;
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
