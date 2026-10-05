import { useApp } from '../store';
import { PeoplePicker } from '../components/UserSwitcher';
import { fmtDate, today } from '../lib/dates';

export function Login() {
  const login = useApp((s) => s.login);
  return (
    <div className="login">
      <div className="login-inner">
        <div className="login-hero">
          <div className="brand">
            <span className="brand-mark">QX</span>
            <span>QEPEX India · Work Tracker</span>
          </div>
          <h1>Track work. Never miss a due date.</h1>
          <p className="muted">
            Prototype for testing. Choose who you are — each role sees only what the spec allows, and Staff and Article Assistants see only their assigned
            clients. Data stays in this browser.
          </p>
          <div className="tag">Today · {fmtDate(today())} · IST</div>
        </div>
        <PeoplePicker onPick={login} />
      </div>
    </div>
  );
}
