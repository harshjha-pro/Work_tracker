import { useState } from 'react';
import { useApp, useMe, type Route } from '../store';
import { navFor } from '../App';
import { ROLE_LABEL } from '../lib/master';
import { Avatar, Confirm, Icon, PageHead } from '../components/ui';
import { UserSwitcher } from '../components/UserSwitcher';

export function More() {
  const me = useMe()!;
  const navigate = useApp((s) => s.navigate);
  const reset = useApp((s) => s.resetDemo);
  const [switcher, setSwitcher] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const nav = navFor(me.role);
  const items = [...nav.practice, ...nav.admin];
  return (
    <div className="stack-lg">
      <PageHead title="More" />
      <button className="card row" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSwitcher(true)}>
        <Avatar user={me} />
        <div className="grow">
          <div className="strong">{me.name}</div>
          <div className="small muted">{ROLE_LABEL[me.role]} · {me.designation} · {me.employeeCode}</div>
        </div>
        <span className="btn sm"><Icon.switch /> Switch user</span>
      </button>
      <div className="card flush list">
        {items.map((n) => (
          <button key={n.route} className="list-item" onClick={() => navigate({ name: n.route } as Route)}>
            <span className="muted" style={{ width: 20 }}><n.icon /></span>
            <span className="grow">{n.label}</span>
            <span className="faint"><Icon.chevron /></span>
          </button>
        ))}
      </div>
      <div className="card stack-sm">
        <h3>Prototype data</h3>
        <p className="small muted">Everything is stored in this browser only. Resetting restores the sample firm, clients and entries as of today.</p>
        <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm(true)}>Reset demo data</button>
      </div>
      {switcher && <UserSwitcher onClose={() => setSwitcher(false)} />}
      {confirm && <Confirm title="Reset demo data?" body="All clients, tasks and entries you added in this browser are replaced with the sample data." confirmLabel="Reset" danger onConfirm={reset} onClose={() => setConfirm(false)} />}
    </div>
  );
}
