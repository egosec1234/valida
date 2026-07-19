import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type Submission } from "../lib/supabaseClient";

// Claude's research isn't guaranteed to include a scheme (e.g. "acme.com"
// instead of "https://acme.com"). Try as-is, then retry with https:// added,
// so we never render an <a href> that silently resolves as a relative path
// on this site. Returns null if the string isn't a usable URL at all.
function normalizeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    try {
      return new URL(`https://${url}`);
    } catch {
      return null;
    }
  }
}

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
    setLoading(true);
    setError(null);

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
      <div className="page">
        <p className="form-error">{error ?? "Submission not found."}</p>
        <Link to="/history" className="back-link">
          &larr; Back to history
        </Link>
      </div>
    );
  }

  if (submission.status === "processing") {
    const isStale = Date.now() - pollStartedAt.current > STALE_AFTER_MS;
    return (
      <div className="page">
        <Link to="/history" className="back-link">
          &larr; Back to history
        </Link>
        <div className="radar radar-small">
          <span className="radar-blip" style={{ top: "30%", left: "60%" }} />
          <span
            className="radar-blip"
            style={{ top: "62%", left: "38%", animationDelay: "0.9s" }}
          />
        </div>
        <div className="scan-status">
          <span className="eyebrow">Scanning</span>
          <h1>Researching your idea</h1>
        </div>
        <p className="idea-text">{submission.idea_text}</p>
        {submission.niche && <p className="niche-tag">{submission.niche}</p>}
        {isStale ? (
          <p className="form-error">
            This is taking much longer than usual and may have failed silently.
            Feel free to keep waiting, or start a new one from the home page.
          </p>
        ) : (
          <p className="empty-note">
            Usually under a minute. This page updates on its own.
          </p>
        )}
      </div>
    );
  }

  if (submission.status === "failed") {
    return (
      <div className="page">
        <Link to="/history" className="back-link">
          &larr; Back to history
        </Link>
        <span className="eyebrow" style={{ color: "var(--danger)" }}>
          Scan failed
        </span>
        <h1 style={{ margin: "0.6rem 0 1.5rem" }}>Something went wrong</h1>
        <p className="idea-text">{submission.idea_text}</p>
        <p className="form-error" style={{ marginTop: "1rem" }}>
          {submission.error_message ?? "The research task failed unexpectedly."}
        </p>
      </div>
    );
  }

  const report = submission.report;

  return (
    <div className="page">
      <Link to="/history" className="back-link">
        &larr; Back to history
      </Link>
      <span className="eyebrow">Scan complete</span>
      <h1 style={{ margin: "0.6rem 0 0.75rem" }}>Your free score</h1>
      <p className="idea-text">{submission.idea_text}</p>
      {submission.niche && <p className="niche-tag">{submission.niche}</p>}

      {!report ? (
        <p className="empty-note">No report available.</p>
      ) : (
        <>
          <div
            className="score-dial"
            style={{ "--pct": report.score } as CSSProperties}
          >
            <span className="score-dial-value">{report.score}</span>
          </div>
          <div className="score-dial-max">OUT OF 100</div>

          <section className="result-section">
            <div className="section-label">Summary</div>
            <p>{report.summary}</p>
          </section>

          <section className="result-section">
            <div className="section-label">Key risks</div>
            <ul className="data-list">
              {report.risks.map((risk, i) => {
                const text = typeof risk === "string" ? risk : risk.risk;
                const explanation = typeof risk === "string" ? undefined : risk.explanation;
                return (
                  <li key={i} className="data-row">
                    <span className="data-row-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="data-row-name">{text}</span>
                      {explanation && (
                        <div className="data-row-detail">{explanation}</div>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="result-section">
            <div className="section-label">Competitors found</div>
            <ul className="data-list">
              {report.competitors.map((c, i) => {
                const url = c.url ? normalizeUrl(c.url) : null;
                return (
                  <li key={i} className="data-row">
                    <span className="data-row-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="data-row-name">{c.name}</span>: {c.description}
                      {url && (
                        <>
                          {" "}
                          <a href={url.href} target="_blank" rel="noreferrer">
                            ({url.hostname.replace("www.", "")})
                          </a>
                        </>
                      )}
                      {c.threat && (
                        <div className="data-row-detail">{c.threat}</div>
                      )}
                      {c.differentiation && (
                        <div className="data-row-detail">{c.differentiation}</div>
                      )}
                      {c.pricing && (
                        <div className="data-row-meta">
                          <span className="data-row-tag">{c.pricing}</span>
                        </div>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="result-section">
            <div className="section-label">Recommendation</div>
            <p>{report.recommendation}</p>
          </section>

          <section className="panel upsell-panel">
            <span className="pill pill-accent">Next step</span>
            <h2 className="panel-title" style={{ margin: "0.75rem 0 0.5rem" }}>
              This score is a snapshot from today
            </h2>
            <p className="panel-subhead" style={{ marginBottom: "1.25rem" }}>
              Competitors and markets shift week to week. Get weekly monitoring on{" "}
              {submission.niche ? <strong>{submission.niche}</strong> : "this niche"}{" "}
              so you find out the moment something changes instead of months later.
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
