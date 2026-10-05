import { useState } from 'react';
import { useApp, useMe } from '../store';
import { can, visibleClientIds } from '../lib/access';
import { SERVICE_LINE_LABEL } from '../lib/master';
import { budgetSignal, clientById, engagementHours } from '../lib/selectors';
import { cx } from '../lib/util';
import { Empty, Icon, PageHead, Pill, fmtH } from '../components/ui';

export function Engagements() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const [kind, setKind] = useState<'one_time' | 'recurring' | 'all'>('one_time');
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const [q, setQ] = useState('');
  const ids = visibleClientIds(db, me);
  const staffView = me.role === 'staff' || me.role === 'article';
  const query = q.trim().toLowerCase();
  const list = db.engagements
    .filter((e) => ids.has(e.clientId))
    .filter((e) => !staffView || e.team.some((m) => m.userId === me.id) || db.clientTeam.some((a) => a.clientId === e.clientId && a.userId === me.id))
    .filter((e) => kind === 'all' || e.type === kind)
    .filter((e) => (status === 'active' ? e.status === 'active' || e.status === 'on_hold' : e.status === 'completed' || e.status === 'archived'))
    .filter((e) => !query || e.title.toLowerCase().includes(query) || clientById(db, e.clientId)!.name.toLowerCase().includes(query))
    .sort((a, b) => clientById(db, a.clientId)!.code.localeCompare(clientById(db, b.clientId)!.code) || a.title.localeCompare(b.title));

  return (
    <div className="stack">
      <PageHead
        title="Engagements"
        sub="Client → Engagement → Task. Recurring engagements come from the compliance calendar; one-time work is created here."
        actions={
          can.manageEngagements(me.role) && (
            <button className="btn primary" onClick={() => navigate({ name: 'engagement-edit' })}>
              <Icon.plus /> New engagement
            </button>
          )
        }
      />
      <div className="row-wrap">
        <div className="chips">
          {(['one_time', 'recurring', 'all'] as const).map((k) => (
            <button key={k} className={cx('chip', kind === k && 'on')} onClick={() => setKind(k)}>
              {k === 'one_time' ? 'One-time' : k === 'recurring' ? 'Recurring' : 'All'}
            </button>
          ))}
        </div>
        <div className="chips">
          {(['active', 'closed'] as const).map((k) => (
            <button key={k} className={cx('chip', status === k && 'on')} onClick={() => setStatus(k)}>
              {k === 'active' ? 'Active' : 'Completed / archived'}
            </button>
          ))}
        </div>
      </div>
      <input id="eng-q" className="input" placeholder="Search engagements or clients" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length ? (
        <div className="card flush list">
          {list.map((e) => {
            const c = clientById(db, e.clientId)!;
            const used = engagementHours(db, e.id);
            const sig = e.type === 'one_time' ? budgetSignal(used, e.budgetHours) : null;
            return (
              <button key={e.id} className="list-item" onClick={() => navigate({ name: 'engagement', id: e.id })}>
                <div className="grow">
                  <div className="ellipsis">
                    <span className="mono small faint">{c.code}</span> <span className="strong">{e.title}</span>
                  </div>
                  <div className="meta ellipsis">
                    {c.name} · {SERVICE_LINE_LABEL[e.serviceLine]} · {fmtH(used)} logged{e.budgetHours && e.type === 'one_time' ? ` of ${fmtH(e.budgetHours)}` : ''}
                  </div>
                </div>
                {e.status === 'on_hold' && <Pill plain>On hold</Pill>}
                {sig && !staffView && <Pill tone={sig.tone === 'ok' ? 'ok' : sig.tone}>{sig.health}</Pill>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Icon.engagements />}>No engagements here.</Empty>
        </div>
      )}
    </div>
  );
}
