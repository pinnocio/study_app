import { Navigate, Route, Routes, Link, useLocation } from "react-router";
import PersonaCompiler from "./PersonaCompiler";
import Summarizer from "./Summarizer";
import LensSummarizer from "./LensSummarizer";
import DraftApp from "./DraftApp";

function NavLink({ to, children }) {
  const location = useLocation();
  const active = location.pathname === to;

  return (
    <Link
      to={to}
      style={{
        padding: "8px 14px",
        borderRadius: 4,
        textDecoration: "none",
        border: `1px solid ${active ? "#9b8c6e" : "#333"}`,
        background: active ? "#2a2520" : "transparent",
        color: active ? "#d4c4a0" : "#888",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </Link>
  );
}

export default function App() {
  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#111",
          borderBottom: "1px solid #1e1e1e",
          padding: "14px 24px",
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <NavLink to="/compiler">Compiler</NavLink>
          <NavLink to="/summarizer">Summarizer</NavLink>
          <NavLink to="/lens">Lens</NavLink>
          <NavLink to="/draft">Draft</NavLink>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="/compiler" replace />} />
        <Route path="/compiler" element={<PersonaCompiler />} />
        <Route path="/summarizer" element={<Summarizer />} />
        <Route path="/lens" element={<LensSummarizer />} />
        <Route path="/draft" element={<DraftApp />} />
      </Routes>
    </div>
  );
}