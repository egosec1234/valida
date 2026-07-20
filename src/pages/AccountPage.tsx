import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function AccountPage() {
  const { user, updateEmail, updatePassword, deleteAccount } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState(user?.email ?? "");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailSubmitting(true);
    setEmailError(null);
    setEmailSuccess(false);
    const { error } = await updateEmail(email);
    setEmailSubmitting(false);
    if (error) {
      setEmailError(error);
      return;
    }
    setEmailSuccess(true);
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordSubmitting(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    const { error } = await updatePassword(password);
    setPasswordSubmitting(false);
    if (error) {
      setPasswordError(error);
      return;
    }
    setPassword("");
    setPasswordSuccess(true);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await deleteAccount();
    setDeleting(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    navigate("/");
  }

  return (
    <div className="page">
      <div className="section-label">Account</div>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "1.5rem" }}>Account settings</h1>

      <section className="panel" style={{ marginBottom: "1.5rem" }}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>Email</h2>
        <form onSubmit={handleEmailSubmit} className="field-group">
          <label>
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {emailError && <p className="form-error">{emailError}</p>}
          {emailSuccess && (
            <p className="form-success">
              Confirmation links sent to your old and new address. Click both to
              finish the change.
            </p>
          )}
          <button type="submit" disabled={emailSubmitting || email === user?.email}>
            {emailSubmitting ? "Saving..." : "Update email"}
          </button>
        </form>
      </section>

      <section className="panel" style={{ marginBottom: "1.5rem" }}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>Password</h2>
        <form onSubmit={handlePasswordSubmit} className="field-group">
          <label>
            New password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {passwordError && <p className="form-error">{passwordError}</p>}
          {passwordSuccess && <p className="form-success">Password updated.</p>}
          <button type="submit" disabled={passwordSubmitting}>
            {passwordSubmitting ? "Saving..." : "Update password"}
          </button>
        </form>
      </section>

      <div className="danger-zone">
        <div className="danger-zone-title">Delete account</div>
        <p className="panel-subhead" style={{ marginBottom: "1rem" }}>
          This permanently deletes your account, your score history, and any
          tracked niches. There's no undo.
        </p>
        <label>
          Type DELETE to confirm
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
          />
        </label>
        {deleteError && <p className="form-error" style={{ marginTop: "0.75rem" }}>{deleteError}</p>}
        <button
          type="button"
          className="danger-button"
          disabled={confirmText !== "DELETE" || deleting}
          onClick={handleDelete}
          style={{ marginTop: "0.9rem" }}
        >
          {deleting ? "Deleting..." : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
