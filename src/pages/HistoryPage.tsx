import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, type Submission } from "../lib/supabaseClient";

export function HistoryPage() {
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setSubmissions(data as Submission[]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="page">
      <div className="section-label">Score history</div>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "1.5rem" }}>Past scores</h1>

      <section className="panel">
        {loading && <p className="empty-note">Loading...</p>}
        {!loading && submissions.length === 0 && (
          <p className="empty-note">
            No submissions yet. Go get your first free score.
          </p>
        )}
        <ul className="report-log">
          {submissions.map((s) => (
            <li key={s.id}>
              <button
                className="report-log-item"
                onClick={() => navigate(`/results/${s.id}`)}
              >
                <span className="report-log-idea">{s.idea_text}</span>
                <span className="report-log-meta">
                  {s.status === "complete" && (
                    <span className="status-pill status-complete">
                      {s.score}/100
                    </span>
                  )}
                  {s.status === "processing" && (
                    <span className="status-pill status-processing">Scanning</span>
                  )}
                  {s.status === "failed" && (
                    <span className="status-pill status-failed">Failed</span>
                  )}
                  <span>{new Date(s.created_at).toLocaleDateString()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
