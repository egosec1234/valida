import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const LINKS = [
  { to: "/", label: "New idea" },
  { to: "/history", label: "Score history", alsoActiveOn: ["/results"] },
  { to: "/tracking", label: "Tracking", alsoActiveOn: ["/track"] },
];

function isLinkActive(pathname: string, link: (typeof LINKS)[number]) {
  if (pathname === link.to) return true;
  return link.alsoActiveOn?.some((prefix) => pathname.startsWith(`${prefix}/`)) ?? false;
}

export function Sidebar() {
  const { signOut } = useAuth();
  const location = useLocation();

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">Valida</div>
      <ul className="sidebar-nav">
        {LINKS.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              className={`sidebar-link${isLinkActive(location.pathname, link) ? " active" : ""}`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={signOut} className="sidebar-logout">
        Log out
      </button>
    </nav>
  );
}
