import { useState } from 'react';
import { useApp, useMe } from '../store';
import { can } from '../lib/access';
import { ROLE_LABEL } from '../lib/master';
import { fmtDateTime } from '../lib/dates';
import { userById } from '../lib/selectors';
import { cx } from '../lib/util';
import { Empty, PageHead } from '../components/ui';

const ENTITIES = ['all', 'client', 'task', 'entry', 'due_date', 'engagement', 'lock', 'template'] as const;
const LABEL: Record<string, string> = { all: 'All', client: 'Clients', task: 'Tasks', entry: 'Work entries', due_date: 'Due dates', engagement: 'Engagements', lock: 'Weekly lock', template: 'Templates' };

export function AuditTrail() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const [f, setF] = useState<(typeof ENTITIES)[number]>('all');
  if (!can.viewAudit(me.role)) return <div><PageHead title="Audit Trail" /><div className="card"><Empty>Not available for your role.</Empty></div></div>;
  const list = db.audit.filter((a) => f === 'all' || a.entity === f).slice(0, 200);
  return (
    <div className="stack">
      <PageHead title="Audit Trail" sub="Who changed what, and when. Changes by Managers, Partners and Admin are attributed by role." />
      <div className="chips">
        {ENTITIES.map((e) => <button key={e} className={cx('chip', f === e && 'on')} onClick={() => setF(e)}>{LABEL[e]}</button>)}
      </div>
      {list.length ? (
        <div className="card flush list">
          {list.map((a) => {
            const u = userById(db, a.by);
            const go = a.entity === 'task' && db.tasks.some((t) => t.id === a.entityId) ? () => navigate({ name: 'task', id: a.entityId }) : a.entity === 'client' && db.clients.some((c) => c.id === a.entityId) ? () => navigate({ name: 'client', id: a.entityId }) : undefined;
            return (
              <button key={a.id} className="list-item" onClick={go} style={{ cursor: go ? 'pointer' : 'default' }}>
                <div className="grow">
                  <div className="small"><strong>{a.action}</strong>{a.detail ? ` — ${a.detail}` : ''}</div>
                  <div className="xs faint">{fmtDateTime(a.at)} · {u ? `${u.name} (${ROLE_LABEL[u.role]})` : 'System'}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card"><Empty>Nothing recorded yet.</Empty></div>
      )}
    </div>
  );
}
