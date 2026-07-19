import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, type TrackedNiche } from "../lib/supabaseClient";

export function TrackingPage() {
  const navigate = useNavigate();
  const [trackedNiches, setTrackedNiches] = useState<TrackedNiche[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("tracked_niches")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setTrackedNiches(data as TrackedNiche[]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="page">
      <div className="section-label">Tracking</div>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>
        Niches you're watching
      </h1>
      <p className="panel-subhead" style={{ marginBottom: "1.5rem" }}>
        Weekly monitoring isn't live yet. This is your waitlist, and we'll email
        you the moment it ships.
      </p>

      <section className="panel">
        {loading && <p className="empty-note">Loading...</p>}
        {!loading && trackedNiches.length === 0 && (
          <p className="empty-note">
            Nothing here yet. Get a free score first, then track the niche from
            the results page.
          </p>
        )}
        <ul className="report-log">
          {trackedNiches.map((t) => (
            <li key={t.id}>
              <button
                className="report-log-item"
                onClick={() => navigate(`/results/${t.submission_id}`)}
              >
                <span className="report-log-idea">{t.niche || "Untitled niche"}</span>
                <span className="report-log-meta">
                  <span className={`status-pill status-${t.status}`}>
                    {t.status === "pending_upgrade" ? "Waiting for launch" : t.status}
                  </span>
                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
