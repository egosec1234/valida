import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Hero } from "../components/Hero";

export function SignupPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signUp(email, password);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <h1 className="panel-title">Check your email</h1>
          <p className="panel-subhead">
            We sent a confirmation link to {email}. Confirm, then log in.
          </p>
          <Link to="/login" className="link-button">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <Hero />
      <div className="panel">
        <h1 className="panel-title">Create an account</h1>
        <form onSubmit={handleSubmit} className="field-group">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing up..." : "Sign up"}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
      <p className="auth-switch">
        By signing up, you agree to our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
