import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SubmissionForm } from "../components/SubmissionForm";
import { supabase, type Submission } from "../lib/supabaseClient";

export function HomePage() {
  const { user, loading } = useAuth();
  const isAdmin = user?.app_metadata?.is_admin === true;

  const [existing, setExisting] = useState<Pick<Submission, "id" | "status"> | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  useEffect(() => {
    if (!user || isAdmin) {
      setCheckingExisting(false);
      return;
    }
    let cancelled = false;
    setCheckingExisting(true);
    supabase
      .from("submissions")
      .select("id, status")
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setExisting(data as Pick<Submission, "id" | "status"> | null);
        setCheckingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin]);

  if (loading) return <p className="page-loading">Loading...</p>;

  if (user) {
    if (checkingExisting) return <p className="page-loading">Loading...</p>;

    if (existing) {
      return (
        <div className="page">
          <div className="section-label">Free score</div>
          <h1 style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>
            You've already used your free score
          </h1>
          <p className="panel-subhead" style={{ marginBottom: "1.5rem" }}>
            The free tier covers one idea per account. Weekly monitoring (coming
            soon) is where ongoing scoring lives.
          </p>
          <div className="panel">
            <Link to={`/results/${existing.id}`} className="button-link">
              {existing.status === "processing"
                ? "View your score in progress →"
                : "View your result →"}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="page">
        <div className="section-label">Step 1 of 2</div>
        <h1 style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>
          Get your free idea score
        </h1>
        <p className="panel-subhead" style={{ marginBottom: "1.5rem" }}>
          Quick and free. Think of it as the way into ongoing monitoring, not
          the whole product.
        </p>
        <div className="panel">
          <SubmissionForm />
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="landing-hero">
        <h1>
          Don't get blindsided by a new competitor after you've already started
          building.
        </h1>
        <p>
          Tell us your idea. We'll give you a free, honest score, then watch
          your niche every week so you're never the last to know when
          something changes.
        </p>
      </div>

      <div className="landing-form-panel">
        <SubmissionForm />
      </div>

      <section className="how-it-works">
        <div className="section-label">How it works</div>
        <div className="how-it-works-steps">
          <div className="how-it-works-step">
            <div className="how-it-works-step-number">01</div>
            <h3>Submit your idea</h3>
            <p>A couple of sentences on what you're building and who it's for.</p>
          </div>
          <div className="how-it-works-step">
            <div className="how-it-works-step-number">02</div>
            <h3>Get scored</h3>
            <p>
              We research your actual market and give you a number out of 100,
              with the reasoning behind it.
            </p>
          </div>
          <div className="how-it-works-step">
            <div className="how-it-works-step-number">03</div>
            <h3>Track your niche</h3>
            <p>
              Turn on weekly monitoring afterward so a new competitor doesn't
              catch you off guard.
            </p>
          </div>
        </div>
      </section>

      <section className="manifesto">
        <p>
          <strong>We're not going to tell you your idea is great.</strong> Most
          validation tools are built to make you feel good, not to give you a
          straight answer. Valida researches what's actually happening in your
          market and tells you what it finds, even when that's a crowded space
          or a competitor who's already three steps ahead.
        </p>
        <p>
          If the news is bad, you'll hear it before you've spent six months
          building instead of after.
        </p>
      </section>

      <p className="landing-footer-note">
        <Link to="/privacy">Privacy Policy</Link>
      </p>
    </div>
  );
}
