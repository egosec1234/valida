import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, type Submission, type TrackedNiche } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const [ideaText, setIdeaText] = useState("");
  const [niche, setNiche] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [trackedNiches, setTrackedNiches] = useState<TrackedNiche[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoadingList(true);
    const [{ data: subs, error: subsError }, { data: tracked }] = await Promise.all([
      supabase.from("submissions").select("*").order("created_at", { ascending: false }),
      supabase.from("tracked_niches").select("*").order("created_at", { ascending: false }),
    ]);
    if (!subsError && subs) setSubmissions(subs as Submission[]);
    if (tracked) setTrackedNiches(tracked as TrackedNiche[]);
    setLoadingList(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error } = await supabase.functions.invoke("analyze", {
      body: { idea_text: ideaText, niche },
    });

    setSubmitting(false);

    if (error) {
      // supabase-js only gives a generic message for non-2xx responses;
      // the actual reason is in the response body on error.context.
      let message = error.message;
      if ("context" in error && error.context instanceof Response) {
        try {
          const body = await error.context.clone().json();
          // Our own function errors use {error}; Supabase's platform-level
          // gateway errors (timeouts, resource limits) use {code, message}.
          if (body?.error) message = body.error;
          else if (body?.message) message = body.message;
        } catch {
          // response body wasn't JSON - fall back to the generic message
        }
      }
      setError(message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setIdeaText("");
    setNiche("");
    navigate(`/results/${data.submission.id}`);
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Valida</h1>
          <p className="tagline">
            Weekly competitive monitoring for your niche — starting with a free idea
            score.
          </p>
        </div>
        <button onClick={signOut} className="link-button">
          Log out
        </button>
      </header>

      <section className="submission-form-section">
        <h2>Step 1: Get your free idea score</h2>
        <p className="section-subhead">
          Quick and free. It's the entry point into ongoing weekly monitoring, not
          the whole product.
        </p>
        <form onSubmit={handleSubmit} className="submission-form">
          <label>
            Business idea
            <textarea
              required
              rows={4}
              placeholder="Describe your business idea..."
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
            />
          </label>
          <label>
            Niche / category
            <input
              type="text"
              placeholder="e.g. B2B SaaS for dentists"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Get my free score"}
          </button>
        </form>
      </section>

      {trackedNiches.length > 0 && (
        <section className="tracked-niches-section">
          <h2>Your tracked niches</h2>
          <ul className="tracked-niches-list">
            {trackedNiches.map((t) => (
              <li key={t.id}>
                <span className="submission-idea">{t.niche || "Untitled niche"}</span>
                <span className={`status-pill status-${t.status}`}>
                  {t.status === "pending_upgrade" ? "Waiting for launch" : t.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="submissions-list-section">
        <h2>Past scores</h2>
        {loadingList && <p>Loading...</p>}
        {!loadingList && submissions.length === 0 && (
          <p>No submissions yet — try the form above.</p>
        )}
        <ul className="submissions-list">
          {submissions.map((s) => (
            <li key={s.id}>
              <button
                className="submission-item"
                onClick={() => navigate(`/results/${s.id}`)}
              >
                <span className="submission-idea">{s.idea_text.slice(0, 80)}</span>
                <span className="submission-meta">
                  {s.status === "complete" && `Score: ${s.score}`}
                  {s.status === "processing" && "Researching..."}
                  {s.status === "failed" && "Failed"} ·{" "}
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
