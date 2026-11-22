import { NavLink, Outlet } from 'react-router-dom';

export default function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-small">FeeSaathi</div>
        <div className="tagline">Your Teaching Business, Financially in Control.</div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="bottom-nav">
        <NavLink to="/home" className="bottom-nav-link">
          <span className="nav-icon">⌂</span>
          <span className="nav-label">Home</span>
        </NavLink>
        <NavLink to="/students" className="bottom-nav-link">
          <span className="nav-icon">◉</span>
          <span className="nav-label">Students</span>
        </NavLink>
        <NavLink to="/invoices" className="bottom-nav-link">
          <span className="nav-icon">▤</span>
          <span className="nav-label">Invoices</span>
        </NavLink>
        <NavLink to="/cash-flow" className="bottom-nav-link">
          <span className="nav-icon">↗</span>
          <span className="nav-label">Cash Flow</span>
        </NavLink>
        <NavLink to="/more" className="bottom-nav-link">
          <span className="nav-icon">≡</span>
          <span className="nav-label">More</span>
        </NavLink>
      </nav>
    </div>
  );
}
