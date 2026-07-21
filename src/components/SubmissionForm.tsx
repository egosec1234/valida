import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { PENDING_KEY } from "../lib/pendingIdea";

const PENDING_MAX_AGE_MS = 30 * 60 * 1000; // discard if stale - don't surprise-submit an old draft
const IDEA_TEXT_MAX_LENGTH = 500;
const NICHE_MAX_LENGTH = 100;

type PendingIdea = { idea_text: string; niche: string; savedAt: number };

export function SubmissionForm() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ideaText, setIdeaText] = useState("");
  const [niche, setNiche] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const autoSubmitted = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // If someone just logged in (or signed up and confirmed) after being
  // prompted to authenticate, pick up where they left off. Uses
  // sessionStorage (tab-scoped) rather than localStorage so a draft from
  // one tab/visitor can't get auto-submitted under a different account
  // logged in from another tab on the same browser.
  useEffect(() => {
    if (!user || autoSubmitted.current) return;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);

    let pending: PendingIdea;
    try {
      pending = JSON.parse(raw);
    } catch {
      return;
    }
    if (Date.now() - pending.savedAt > PENDING_MAX_AGE_MS) return;

    autoSubmitted.current = true;
    setIdeaText(pending.idea_text);
    setNiche(pending.niche);
    submitIdea(pending.idea_text, pending.niche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function submitIdea(idea_text: string, nicheValue: string) {
    setSubmitting(true);
    setError(null);

    const { data, error } = await supabase.functions.invoke("analyze", {
      body: { idea_text, niche: nicheValue },
    });

    if (!mounted.current) return;
    setSubmitting(false);

    if (error) {
      // supabase-js only gives a generic message for non-2xx responses;
      // the actual reason is in the response body on error.context.
      let message = error.message;
      let existingSubmissionId: string | undefined;
      if ("context" in error && error.context instanceof Response) {
        try {
          const body = await error.context.clone().json();
          // Our own function errors use {error}; Supabase's platform-level
          // gateway errors (timeouts, resource limits) use {code, message}.
          if (body?.error) message = body.error;
          else if (body?.message) message = body.message;
          existingSubmissionId = body?.existingSubmissionId;
        } catch {
          // response body wasn't JSON - fall back to the generic message
        }
      }
      if (!mounted.current) return;
      if (existingSubmissionId) {
        navigate(`/results/${existingSubmissionId}`);
        return;
      }
      setError(message);
      return;
    }
    if (data?.error) {
      if (!mounted.current) return;
      if (data.existingSubmissionId) {
        navigate(`/results/${data.existingSubmissionId}`);
        return;
      }
      setError(data.error);
      return;
    }

    setIdeaText("");
    setNiche("");
    if (mounted.current) navigate(`/results/${data.submission.id}`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!user) {
      const pending: PendingIdea = { idea_text: ideaText, niche, savedAt: Date.now() };
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      setAwaitingAuth(true);
      return;
    }

    await submitIdea(ideaText, niche);
  }

  if (awaitingAuth) {
    return (
      <div className="auth-prompt">
        <p>
          One more step: create a free account (or log in if you already have
          one) and we'll score this idea right away, using what you already
          typed.
        </p>
        <div className="auth-prompt-actions">
          <Link to="/signup" className="button-link">
            Sign up
          </Link>
          <Link to="/login" className="link-button" style={{ alignSelf: "center" }}>
            Log in instead
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="field-group">
      <label>
        Business idea
        <textarea
          required
          rows={4}
          maxLength={IDEA_TEXT_MAX_LENGTH}
          placeholder="Describe your business idea..."
          value={ideaText}
          onChange={(e) => setIdeaText(e.target.value)}
        />
      </label>
      <label>
        Niche / category
        <input
          type="text"
          maxLength={NICHE_MAX_LENGTH}
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
  );
}
