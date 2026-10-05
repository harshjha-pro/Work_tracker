import { useState } from 'react';
import { useApp, useMe } from '../store';
import { visibleTasks, visibleClientIds } from '../lib/access';
import { isOverdue } from '../lib/compliance';
import { diffDays, today } from '../lib/dates';
import { isFiled, isOpen } from '../lib/master';
import { userById, firstName } from '../lib/selectors';
import { cx } from '../lib/util';
import { Empty, PageHead, Seg } from '../components/ui';
import { DueRow } from './Home';

type Filter = 'open' | 'week' | 'overdue' | 'pending' | 'review' | 'filed' | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'week', label: 'Due in 7 days' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending from client' },
  { value: 'review', label: 'Under review' },
  { value: 'filed', label: 'Filed' },
  { value: 'all', label: 'All' },
];

export function Tasks({ initialFilter }: { initialFilter?: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const firmView = me.role === 'partner' || me.role === 'manager' || me.role === 'admin';
  const [scope, setScope] = useState<'mine' | 'all'>(firmView && initialFilter ? 'all' : firmView ? 'all' : 'mine');
  const [filter, setFilter] = useState<Filter>((initialFilter as Filter) ?? 'open');
  const [clientId, setClientId] = useState('');
  const [query, setQuery] = useState('');
  const t = today();

  const clientIds = visibleClientIds(db, me);
  let tasks = visibleTasks(db, me);
  if (scope === 'mine') tasks = tasks.filter((x) => x.assignedTo === me.id || x.checkerId === me.id);
  if (clientId) tasks = tasks.filter((x) => x.clientId === clientId);
  const q = query.trim().toLowerCase();
  if (q) tasks = tasks.filter((x) => x.title.toLowerCase().includes(q) || db.clients.find((c) => c.id === x.clientId)!.name.toLowerCase().includes(q));
  const counts: Record<Filter, number> = { open: 0, week: 0, overdue: 0, pending: 0, review: 0, filed: 0, all: tasks.length };
  const match = (f: Filter, x: (typeof tasks)[number]) => {
    switch (f) {
      case 'open': return isOpen(x.status);
      case 'week': return isOpen(x.status) && x.effectiveDue >= t && diffDays(x.effectiveDue, t) <= 7;
      case 'overdue': return isOverdue(x);
      case 'pending': return x.status === 'pending_from_client';
      case 'review': return x.status === 'under_review';
      case 'filed': return isFiled(x.status);
      default: return true;
    }
  };
  for (const x of tasks) for (const f of FILTERS) if (f.value !== 'all' && match(f.value, x)) counts[f.value]++;
  const list = tasks
    .filter((x) => match(filter, x))
    .sort((a, b) => (filter === 'filed' ? b.effectiveDue.localeCompare(a.effectiveDue) : Number(isOverdue(b)) - Number(isOverdue(a)) || a.effectiveDue.localeCompare(b.effectiveDue)));
  const shown = list.slice(0, 150);

  return (
    <div className="stack">
      <PageHead
        title={scope === 'mine' ? 'My Tasks' : 'Tasks'}
        sub={scope === 'mine' ? 'Compliance tasks and engagements assigned to you' : me.role === 'partner' || me.role === 'admin' ? 'Every client in the firm' : 'Every client on your teams'}
        actions={<Seg value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Assigned to me' }, { value: 'all', label: me.role === 'partner' || me.role === 'admin' ? 'Firm' : 'My clients' }]} />}
      />
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.value} className={cx('chip', filter === f.value && 'on')} onClick={() => setFilter(f.value)}>
            {f.label} <span className="num" style={{ opacity: 0.7 }}>{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <div className="grid-2">
        <input id="task-search" className="input" placeholder="Search tasks or clients" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select id="task-client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {db.clients
            .filter((c) => clientIds.has(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
        </select>
      </div>
      {shown.length ? (
        <div className="card flush list">
          {shown.map((x) => (
            <div key={x.id} style={{ position: 'relative' }}>
              <DueRow task={x} onClick={() => navigate({ name: 'task', id: x.id })} />
              {scope === 'all' && x.assignedTo && (
                <span className="xs faint" style={{ position: 'absolute', right: 14, bottom: 4 }}>
                  {firstName(userById(db, x.assignedTo))}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty>{filter === 'overdue' ? 'Nothing overdue.' : 'No tasks match these filters.'}</Empty>
        </div>
      )}
      {list.length > shown.length && <div className="muted small">Showing the first {shown.length} of {list.length}. Narrow by client to see more.</div>}
    </div>
  );
}
