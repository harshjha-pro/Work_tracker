import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { Task, TaskStatus } from '../lib/types';
import { can, isLocked, lockAt, visiblePeople, visibleTasks } from '../lib/access';
import { isOverdue } from '../lib/compliance';
import { addDays, dayName, fmtDate, fmtDateTime, fmtShort, today, weekDates, weekStart, weekday } from '../lib/dates';
import { isFiled, isOpen } from '../lib/master';
import { clientById, entriesOn, firstName, hoursOf, isLeaveDay, pendingDays, userById } from '../lib/selectors';
import { cx, sum } from '../lib/util';
import { Empty, Icon, PageHead, Pill, StatusPill, fmtH } from '../components/ui';
import { LockExtendSheet } from './Settings';

type Bucket = 'overdue' | 'filed' | 'filed_late' | 'under_review' | 'pending_from_client' | 'in_progress' | 'upcoming';
const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: 'overdue', label: 'Overdue', color: 'var(--bad)' },
  { key: 'pending_from_client', label: 'Pending from client', color: 'var(--warn)' },
  { key: 'under_review', label: 'Under review', color: 'var(--review)' },
  { key: 'in_progress', label: 'In progress', color: 'var(--info)' },
  { key: 'upcoming', label: 'Not started', color: 'var(--idle)' },
  { key: 'filed_late', label: 'Filed late', color: 'color-mix(in srgb, var(--warn) 55%, var(--ok))' },
  { key: 'filed', label: 'Filed on time', color: 'var(--ok)' },
];

function bucket(t: Task): Bucket {
  if (isOverdue(t)) return 'overdue';
  return t.status as Exclude<TaskStatus, 'not_applicable'>;
}

export function TeamWeek() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const t = today();
  const [ws, setWs] = useState(weekStart(t));
  const [extendFor, setExtendFor] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<Bucket | null>(null);
  const days = weekDates(ws, 6);
  const end = addDays(ws, 6);

  if (!can.viewTeam(me.role)) {
    return (
      <div>
        <PageHead title="This Week" />
        <div className="card"><Empty>Team views are for Managers and Partners.</Empty></div>
      </div>
    );
  }

  const scoped = visibleTasks(db, me).filter((x) => x.status !== 'not_applicable');
  const dueThisWeek = scoped.filter((x) => x.effectiveDue >= ws && x.effectiveDue <= end);
  const carried = ws === weekStart(t) ? scoped.filter((x) => isOverdue(x) && x.effectiveDue < ws) : [];
  const weekTasks = [...carried, ...dueThisWeek];
  const counts = BUCKETS.map((b) => ({ ...b, tasks: weekTasks.filter((x) => bucket(x) === b.key) }));
  const total = weekTasks.length || 1;
  const people = visiblePeople(db, me).filter((u) => u.role !== 'admin' && u.joiningDate <= end);
  const pending = scoped.filter((x) => x.status === 'pending_from_client').sort((a, b) => pendingDays(b) - pendingDays(a));
  const filedOnTime = counts.find((c) => c.key === 'filed')!.tasks.length;
  const closed = weekTasks.filter((x) => isFiled(x.status)).length;

  return (
    <div className="stack-lg">
      <PageHead
        title="This Week"
        sub={me.role === 'partner' || me.role === 'admin' ? 'Firm-wide compliance status and hours logged' : 'Compliance status and hours for your clients and team'}
        actions={
          <div className="row">
            <button className="icon-btn" onClick={() => setWs(addDays(ws, -7))} aria-label="Previous week"><Icon.left /></button>
            <span className="small strong nowrap">{fmtShort(ws)} – {fmtShort(addDays(ws, 5))}</span>
            <button className="icon-btn" onClick={() => setWs(addDays(ws, 7))} aria-label="Next week"><Icon.right /></button>
          </div>
        }
      />

      <section className="card stack">
        <div className="section-head">
          <h2>Compliance due this week</h2>
          <span className="small muted">
            {weekTasks.length} task{weekTasks.length === 1 ? '' : 's'}{carried.length ? ` (incl. ${carried.length} overdue from earlier)` : ''} · {closed} filed, {filedOnTime} on time
          </span>
        </div>
        <div className="bar-h">
          <div className="track" style={{ height: 14 }}>
            {counts.filter((c) => c.tasks.length).map((c) => (
              <span key={c.key} title={`${c.label}: ${c.tasks.length}`} style={{ width: `${(c.tasks.length / total) * 100}%`, background: c.color }} />
            ))}
          </div>
        </div>
        <div className="chips">
          {counts.filter((c) => c.tasks.length).map((c) => (
            <button key={c.key} className={cx('chip', open === c.key && 'on')} onClick={() => setOpen(open === c.key ? null : c.key)}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c.color, marginRight: 6 }} />
              {c.label} · {c.tasks.length}
            </button>
          ))}
        </div>
        {weekTasks.length === 0 && <div className="muted small">No statutory due dates this week.</div>}
        <div className="card flush list">
          {(open ? counts.find((c) => c.key === open)!.tasks : weekTasks.filter((x) => isOpen(x.status)))
            .sort((a, b) => a.effectiveDue.localeCompare(b.effectiveDue))
            .map((x) => {
              const c = clientById(db, x.clientId)!;
              return (
                <button key={x.id} className="list-item" onClick={() => navigate({ name: 'task', id: x.id })}>
                  <div className="grow">
                    <div className="ellipsis"><span className="mono small faint">{c.code}</span> <span className="strong">{x.title}</span></div>
                    <div className="meta ellipsis">{c.name} · due {fmtShort(x.effectiveDue)} · {firstName(userById(db, x.assignedTo))}</div>
                  </div>
                  <StatusPill task={x} />
                </button>
              );
            })}
        </div>
        {!open && weekTasks.some((x) => isFiled(x.status)) && <div className="xs muted">Showing open items. Tap a status above to see filed ones.</div>}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Hours logged</h2>
          {can.extendLock(me.role) && (
            <button className="btn sm" onClick={() => setExtendFor(null)}>
              <Icon.unlock /> Extend lock for this week
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col">Person</th>
                {days.map((d) => <th key={d} className="n">{dayName(d)} {Number(d.slice(8))}</th>)}
                <th className="n">Week</th>
                <th>Lock</th>
              </tr>
            </thead>
            <tbody>
              {people.map((u) => {
                const hrs = days.map((d) => hoursOf(entriesOn(db, u.id, d)));
                const locked = isLocked(db, u.id, ws);
                return (
                  <tr key={u.id}>
                    <td className="sticky-col">
                      <div className="small strong">{u.name.replace(/^CA /, '')}</div>
                      <div className="xs muted">{u.designation}</div>
                    </td>
                    {days.map((d, i) => {
                      const leave = isLeaveDay(db, u.id, d);
                      const missing = d < t && d >= u.joiningDate && weekday(d) !== 0 && !entriesOn(db, u.id, d).length;
                      return (
                        <td key={d} className="n mono" style={{ color: missing ? 'var(--warn)' : undefined }}>
                          {leave ? <Pill tone="info" plain>Leave</Pill> : hrs[i] ? fmtH(hrs[i]).replace(' h', '') : missing ? 'missing' : d > t ? '' : '—'}
                        </td>
                      );
                    })}
                    <td className="n mono strong">{fmtH(sum(hrs)).replace(' h', '')}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <span className="xs muted nowrap" title={`Locks ${fmtDateTime(lockAt(db, u.id, ws).toISOString())}`}>
                          {locked ? 'Locked' : `Until ${fmtShort(lockAt(db, u.id, ws).toISOString().slice(0, 10))}`}
                        </span>
                        {can.extendLock(me.role) && locked && (
                          <button className="btn ghost sm" onClick={() => setExtendFor(u.id)} title="Extend for this person">
                            <Icon.unlock />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col" style={{ background: 'var(--surface-2)' }}>Team</td>
                {days.map((d) => <td key={d} className="n mono">{fmtH(sum(people.map((u) => hoursOf(entriesOn(db, u.id, d))))).replace(' h', '')}</td>)}
                <td className="n mono">{fmtH(sum(people.flatMap((u) => days.map((d) => hoursOf(entriesOn(db, u.id, d)))))).replace(' h', '')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="xs muted">Hours show effort, not performance. “missing” marks a working day with nothing logged — leave days are shown separately.</div>
      </section>

      <section className="stack">
        <h2>Pending from client ({pending.length})</h2>
        {pending.length ? (
          <div className="card flush list">
            {pending.map((x) => {
              const c = clientById(db, x.clientId)!;
              const last = [...x.followUps].sort((a, b) => b.at.localeCompare(a.at))[0];
              const p = x.pendingPeriods.find((pp) => !pp.to);
              return (
                <button key={x.id} className="list-item" onClick={() => navigate({ name: 'task', id: x.id })}>
                  <div className="grow">
                    <div className="ellipsis"><span className="mono small faint">{c.code}</span> <span className="strong">{x.title}</span></div>
                    <div className="meta ellipsis">{p?.what ?? 'Awaiting client'} · {last ? `last follow-up ${fmtShort(last.at)} (${last.channel})` : 'no follow-up logged'}</div>
                  </div>
                  <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                    <Pill tone="warn">{pendingDays(x)} days waiting</Pill>
                    <span className="xs muted">due {fmtDate(x.effectiveDue)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="card muted small">Nothing is waiting on clients.</div>
        )}
      </section>

      {extendFor !== undefined && <LockExtendSheet weekStart={ws} userId={extendFor} onClose={() => setExtendFor(undefined)} />}
    </div>
  );
}
