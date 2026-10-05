import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { ISODate, Task } from '../lib/types';
import { addDays, fmtDay, iso, monthLabel, today, weekday, weekStart } from '../lib/dates';
import { isLocked, visiblePeople, visibleTasks } from '../lib/access';
import { isOverdue } from '../lib/compliance';
import { INTERNAL_LABEL } from '../lib/master';
import { clientById, entriesOn, hoursOf, isLeaveDay } from '../lib/selectors';
import { cx } from '../lib/util';
import { Icon, PageHead, fmtH } from '../components/ui';
import { DueRow } from './Home';

function tone(t: Task): string {
  if (isOverdue(t)) return 'c-bad';
  switch (t.status) {
    case 'filed': return 'c-ok';
    case 'filed_late': return 'c-warn';
    case 'pending_from_client': return 'c-warn';
    case 'under_review': return 'c-review';
    case 'in_progress': return 'c-info';
    default: return 'c-idle';
  }
}

const ORDER = ['c-bad', 'c-warn', 'c-review', 'c-info', 'c-idle', 'c-ok'];

export function CalendarScreen() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const openSheet = useApp((s) => s.openSheet);
  const t = today();
  const [ym, setYm] = useState({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) });
  const [sel, setSel] = useState<ISODate>(t);
  const [personal, setPersonal] = useState(true);
  const [compliance, setCompliance] = useState(true);
  const people = visiblePeople(db, me);
  const [personId, setPersonId] = useState(me.id);
  const person = db.users.find((u) => u.id === personId) ?? me;
  const [mineOnly, setMineOnly] = useState(me.role === 'staff' || me.role === 'article');

  const first = iso(ym.y, ym.m, 1);
  const gridStart = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const lastRowNeeded = days.slice(35).some((d) => d.slice(5, 7) === first.slice(5, 7));
  const grid = lastRowNeeded ? days : days.slice(0, 35);

  let tasks = visibleTasks(db, me).filter((x) => x.status !== 'not_applicable');
  if (mineOnly) tasks = tasks.filter((x) => x.assignedTo === me.id);
  const byDay = new Map<string, Task[]>();
  for (const x of tasks) {
    const arr = byDay.get(x.effectiveDue) ?? [];
    arr.push(x);
    byDay.set(x.effectiveDue, arr);
  }

  const shift = (n: number) => {
    let m = ym.m + n;
    let y = ym.y;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ y, m });
  };

  const selEntries = entriesOn(db, person.id, sel);
  const selTasks = (byDay.get(sel) ?? []).sort((a, b) => ORDER.indexOf(tone(a)) - ORDER.indexOf(tone(b)));

  return (
    <div className="stack">
      <PageHead title="Calendar" sub={me.role === 'partner' || me.role === 'admin' ? 'Your days and the whole firm’s due dates' : 'Your days and due dates for your assigned clients'} />
      <div className="row-wrap between">
        <div className="row">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon.left /></button>
          <h2 style={{ minWidth: 100, textAlign: 'center' }}>{monthLabel(ym.y, ym.m)}</h2>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon.right /></button>
          <button className="btn sm" onClick={() => { setYm({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) }); setSel(t); }}>Today</button>
        </div>
        <div className="chips">
          <button className={cx('chip', personal && 'on')} onClick={() => setPersonal((v) => !v)}>Personal layer</button>
          <button className={cx('chip', compliance && 'on')} onClick={() => setCompliance((v) => !v)}>Compliance layer</button>
          {(me.role === 'staff' || me.role === 'article' || me.role === 'manager') && compliance && (
            <button className={cx('chip', mineOnly && 'on')} onClick={() => setMineOnly((v) => !v)}>Assigned to me only</button>
          )}
        </div>
      </div>
      {people.length > 1 && personal && (
        <select id="cal-person" className="input" style={{ maxWidth: 320 }} value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {people.map((u) => (
            <option key={u.id} value={u.id}>{u.id === me.id ? `Me — ${u.name}` : u.name}</option>
          ))}
        </select>
      )}

      <div className="cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="dow">{d}</div>
        ))}
        {grid.map((d) => {
          const inMonth = d.slice(5, 7) === first.slice(5, 7);
          const es = entriesOn(db, person.id, d);
          const h = hoursOf(es);
          const leave = isLeaveDay(db, person.id, d);
          const missing = d < t && weekday(d) !== 0 && es.length === 0 && d >= person.joiningDate;
          const locked = d <= t && isLocked(db, person.id, d);
          const due = byDay.get(d) ?? [];
          const groups = ORDER.map((c) => ({ c, n: due.filter((x) => tone(x) === c).length })).filter((g) => g.n);
          return (
            <button key={d} className={cx('day', !inMonth && 'out', d === sel && 'sel', d === t && 'today')} onClick={() => setSel(d)}>
              <div className="row between" style={{ gap: 2 }}>
                <span className="dnum">{Number(d.slice(8))}</span>
                {personal && locked && es.length > 0 && <span className="lock-ico"><Icon.lock /></span>}
              </div>
              {personal && (leave ? <span className="p-tag p-leave">Leave</span> : es.length ? <span className="p-tag p-logged">{fmtH(h)}</span> : missing ? <span className="p-tag p-missing">Missing</span> : null)}
              {compliance && groups.length > 0 && (
                <div className="c-dots">
                  {groups.map((g) => (
                    <span key={g.c} className={cx('c-dot', g.c)}>{g.n}</span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="legend">
        {personal && (
          <>
            <span><i className="p-logged" style={{ background: 'var(--ok-soft)' }} />Logged</span>
            <span><i style={{ background: 'var(--warn-soft)' }} />Missing entries</span>
            <span><i style={{ background: 'var(--info-soft)' }} />Leave</span>
            <span><span className="lock-ico"><Icon.lock /></span>Locked</span>
          </>
        )}
        {compliance && (
          <>
            <span><i style={{ background: 'var(--bad)' }} />Overdue</span>
            <span><i style={{ background: 'var(--warn)' }} />Pending from client / filed late</span>
            <span><i style={{ background: 'var(--review)' }} />Under review</span>
            <span><i style={{ background: 'var(--info)' }} />In progress</span>
            <span><i style={{ background: 'var(--idle)' }} />Upcoming</span>
            <span><i style={{ background: 'var(--ok)' }} />Filed</span>
          </>
        )}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {personal && (
          <div className="card flush">
            <div className="card-head" style={{ padding: '14px 14px 0' }}>
              <h2>{fmtDay(sel)}{person.id !== me.id ? ` · ${person.name.split(' ')[0]}` : ''}</h2>
              <span className="num strong">{fmtH(hoursOf(selEntries))}</span>
            </div>
            {selEntries.length ? (
              <div className="list">
                {selEntries.map((e) => {
                  const c = clientById(db, e.clientId);
                  return (
                    <button key={e.id} className="list-item" onClick={() => openSheet({ entryId: e.id })}>
                      <div className="grow">
                        <div className="ellipsis small">
                          {c ? <><span className="mono faint">{c.code}</span> {c.name}</> : INTERNAL_LABEL[e.internalCategory ?? 'other']}
                        </div>
                        <div className="xs muted ellipsis">{[e.stage, e.description].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className="mono small">{e.internalCategory === 'leave' && !e.hours ? 'Leave' : fmtH(e.hours)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="muted small" style={{ padding: 14 }}>
                {sel > t ? 'A future day.' : weekday(sel) === 0 ? 'Sunday.' : 'Nothing logged.'}
                {person.id === me.id && sel <= t && !isLocked(db, me.id, sel) && (
                  <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => openSheet({ date: sel })}>Log work</button>
                )}
              </div>
            )}
          </div>
        )}
        {compliance && (
          <div className="card flush">
            <div className="card-head" style={{ padding: '14px 14px 0' }}>
              <h2>Due {fmtDay(sel)}</h2>
              <span className="small muted">{selTasks.length} task{selTasks.length === 1 ? '' : 's'}</span>
            </div>
            {selTasks.length ? (
              <div className="list">
                {selTasks.map((x) => <DueRow key={x.id} task={x} onClick={() => navigate({ name: 'task', id: x.id })} />)}
              </div>
            ) : (
              <div className="muted small" style={{ padding: 14 }}>No statutory due dates on this day.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
