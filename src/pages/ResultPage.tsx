import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type Competitor, type Pivot, type Risk, type Source, type Submission } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

function riskText(risk: string | Risk): string {
  return typeof risk === "string" ? risk : risk.risk;
}

function riskExplanation(risk: string | Risk): string | undefined {
  return typeof risk === "string" ? undefined : risk.explanation;
}

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

// Shared between the unlocked view (every row plain) and the free preview
// (later rows blurred) so the row markup isn't tripled across both.
function RiskRow({ risk, index, blurred }: { risk: string | Risk; index: number; blurred?: boolean }) {
  const explanation = riskExplanation(risk);
  return (
    <li className={blurred ? "data-row blur-gate" : "data-row"} aria-hidden={blurred || undefined}>
      <span className="data-row-index">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <span className="data-row-name">{riskText(risk)}</span>
        {explanation && <div className="data-row-detail">{explanation}</div>}
      </span>
    </li>
  );
}

function PivotRow({ pivot, index }: { pivot: Pivot; index: number }) {
  return (
    <li className="data-row">
      <span className="data-row-index">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <span className="data-row-name">{pivot.pivot}</span>
        <div className="data-row-detail">{pivot.reason}</div>
      </span>
    </li>
  );
}

function SourceRow({ source, index, blurred }: { source: Source; index: number; blurred?: boolean }) {
  const url = normalizeUrl(source.url);
  return (
    <li className={blurred ? "data-row blur-gate" : "data-row"} aria-hidden={blurred || undefined}>
      <span className="data-row-index">{String(index + 1).padStart(2, "0")}</span>
      {url ? (
        <a href={url.href} target="_blank" rel="noreferrer" className="data-row-name">
          {source.title}
        </a>
      ) : (
        <span className="data-row-name">{source.title}</span>
      )}
    </li>
  );
}

function CompetitorRow({
  competitor,
  index,
  rowBlurred,
  howToCompeteBlurred,
}: {
  competitor: Competitor;
  index: number;
  rowBlurred?: boolean;
  howToCompeteBlurred?: boolean;
}) {
  const url = competitor.url ? normalizeUrl(competitor.url) : null;
  return (
    <li className={rowBlurred ? "data-row blur-gate" : "data-row"} aria-hidden={rowBlurred || undefined}>
      <span className="data-row-index">{String(index + 1).padStart(2, "0")}</span>
      <span>
        <span className="data-row-name">{competitor.name}</span>: {competitor.description}
        {url && (
          <>
            {" "}
            <a href={url.href} target="_blank" rel="noreferrer">
              ({url.hostname.replace("www.", "")})
            </a>
          </>
        )}
        {competitor.threat && <div className="data-row-detail">{competitor.threat}</div>}
        {competitor.differentiation && (
          <div className="data-row-detail">{competitor.differentiation}</div>
        )}
        {competitor.pricing && (
          <div className="data-row-meta">
            <span className="data-row-tag">{competitor.pricing}</span>
          </div>
        )}
        {competitor.howToCompete && (
          <div
            className={howToCompeteBlurred && !rowBlurred ? "data-row-detail blur-gate" : "data-row-detail"}
            aria-hidden={howToCompeteBlurred && !rowBlurred ? true : undefined}
          >
            <strong style={{ color: "var(--ink)" }}>How to compete: </strong>
            {competitor.howToCompete}
          </div>
        )}
      </span>
    </li>
  );
}

const POLL_INTERVAL_MS = 3000;
// If a submission is still "processing" after this long, the background
// worker most likely died mid-run (e.g. hit the platform's wall-clock cap)
// with no chance to mark itself failed - surface that instead of polling forever.
const STALE_AFTER_MS = 3 * 60 * 1000;

export function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.app_metadata?.is_admin === true;
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
          <h1>Researching your idea</h1>
        </div>
        <p className="idea-text">{submission.idea_text}</p>
        {submission.niche && <p className="niche-tag">{submission.niche}</p>}
        {isStale ? (
          <>
            <p className="form-error">
              This is taking much longer than usual and may have failed
              silently. Feel free to keep waiting, or start a new one.
            </p>
            <Link to="/" className="button-link">
              Try again &rarr;
            </Link>
          </>
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
        <h1 style={{ margin: "0 0 1.5rem" }}>Something went wrong</h1>
        <p className="idea-text">{submission.idea_text}</p>
        <p className="form-error" style={{ marginTop: "1rem" }}>
          {submission.error_message ?? "The research task failed unexpectedly."}
        </p>
        <Link to="/" className="button-link" style={{ marginTop: "1rem" }}>
          Try again &rarr;
        </Link>
      </div>
    );
  }

  const report = submission.report;
  const isUnlocked = submission.unlocked || isAdmin;
  const topRisk = report?.risks[0];
  const topRiskText = topRisk ? riskText(topRisk) : "No major risks flagged.";
  const topRiskExplanation = topRisk ? riskExplanation(topRisk) : undefined;

  return (
    <div className="page">
      <Link to="/history" className="back-link">
        &larr; Back to history
      </Link>
      <h1 style={{ margin: "0 0 0.75rem" }}>Your free score</h1>
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

          {isUnlocked ? (
            <>
              <section className="result-section">
                <div className="section-label">Summary</div>
                <p>{report.summary}</p>
              </section>

              <section className="result-section">
                <div className="section-label">Key risks</div>
                <ul className="data-list">
                  {report.risks.map((risk, i) => (
                    <RiskRow key={i} risk={risk} index={i} />
                  ))}
                </ul>
              </section>

              <section className="result-section">
                <div className="section-label">Competitors found</div>
                <ul className="data-list">
                  {report.competitors.map((c, i) => (
                    <CompetitorRow key={i} competitor={c} index={i} />
                  ))}
                </ul>
              </section>

              <section className="result-section">
                <div className="section-label">Recommendation</div>
                <p>{report.recommendation}</p>
                {report.pivots && report.pivots.length > 0 && (
                  <>
                    <div className="section-label" style={{ marginTop: "1.25rem" }}>
                      Alternate directions
                    </div>
                    <ul className="data-list">
                      {report.pivots.map((p, i) => (
                        <PivotRow key={i} pivot={p} index={i} />
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {report.sources && report.sources.length > 0 && (
                <section className="result-section">
                  <div className="section-label">Sources</div>
                  <ul className="data-list">
                    {report.sources.map((s, i) => (
                      <SourceRow key={i} source={s} index={i} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              <section className="result-section">
                <div className="section-label">Summary</div>
                <div className="blur-gate" aria-hidden="true">
                  <p>{report.summary}</p>
                </div>
              </section>

              <section className="result-section">
                <div className="section-label">Biggest risk</div>
                <p>{topRiskText}</p>
                {topRiskExplanation && (
                  <div className="data-row-detail blur-gate" aria-hidden="true">
                    {topRiskExplanation}
                  </div>
                )}
              </section>

              {report.risks.length > 1 && (
                <section className="result-section">
                  <div className="section-label">Other risks</div>
                  <ul className="data-list">
                    {report.risks.slice(1).map((risk, i) => (
                      <RiskRow key={i} risk={risk} index={i + 1} blurred />
                    ))}
                  </ul>
                </section>
              )}

              <section className="result-section">
                <div className="section-label">Competitors found</div>
                <ul className="data-list">
                  {report.competitors[0] && (
                    <CompetitorRow competitor={report.competitors[0]} index={0} howToCompeteBlurred />
                  )}
                  {report.competitors.slice(1).map((c, i) => (
                    <CompetitorRow key={i} competitor={c} index={i + 1} rowBlurred />
                  ))}
                </ul>
              </section>

              <section className="result-section">
                <div className="section-label">Recommendation</div>
                <p>
                  {report.basicRecommendation ??
                    "Unlock the full report to see our recommendation."}
                </p>
                <div className="blur-gate" style={{ marginTop: "0.75rem" }} aria-hidden="true">
                  <p>{report.recommendation}</p>
                  {report.pivots && report.pivots.length > 0 && (
                    <ul className="data-list">
                      {report.pivots.map((p, i) => (
                        <PivotRow key={i} pivot={p} index={i} />
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {report.sources && report.sources.length > 0 && (
                <section className="result-section">
                  <div className="section-label">Sources</div>
                  <ul className="data-list blur-gate" aria-hidden="true">
                    {report.sources.map((s, i) => (
                      <SourceRow key={i} source={s} index={i} />
                    ))}
                  </ul>
                </section>
              )}

              <section className="panel upsell-panel">
                <span className="pill pill-accent">Full report</span>
                <h2 className="panel-title" style={{ margin: "0.75rem 0 0.5rem" }}>
                  Unlock the full report
                </h2>
                <p className="panel-subhead" style={{ marginBottom: "1.25rem" }}>
                  Unlock to see the rest of the competitors with a specific
                  way to compete with each one, every risk explained, the
                  full recommendation with alternate directions if there's a
                  better one, and the sources behind all of it.
                </p>
                <button type="button" className="button-link" disabled>
                  Unlock full report
                </button>
                <p className="empty-note" style={{ marginTop: "0.6rem" }}>
                  Payment isn't set up yet. Check back soon.
                </p>
              </section>
            </>
          )}

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
