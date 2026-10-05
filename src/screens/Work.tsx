import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { ISODate, WorkEntry } from '../lib/types';
import { addDays, dayName, fmtDate, fmtDateTime, fmtDay, today, weekDates, weekStart, weekday } from '../lib/dates';
import { isLocked, lockAt } from '../lib/access';
import { INTERNAL_LABEL, LOCATION_LABEL } from '../lib/master';
import { clientById, entriesBetween, entriesOn, hoursOf, taskById } from '../lib/selectors';
import { cx, sum } from '../lib/util';
import { Empty, Icon, PageHead, Seg, fmtH } from '../components/ui';

export function Work({ date, view }: { date?: ISODate; view?: 'day' | 'week' }) {
  const [mode, setMode] = useState<'day' | 'week'>(view ?? 'day');
  const [day, setDay] = useState<ISODate>(date ?? today());
  return (
    <div>
      <PageHead
        title="Work"
        sub="Log what you worked on. No targets — just a record of effort and progress."
        actions={<Seg value={mode} onChange={setMode} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />}
      />
      {mode === 'day' ? <DayView day={day} setDay={setDay} /> : <WeekView day={day} setDay={setDay} openDay={(d) => { setDay(d); setMode('day'); }} />}
    </div>
  );
}

function LockLine({ day }: { day: ISODate }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const at = lockAt(db, me.id, day);
  const locked = isLocked(db, me.id, day);
  const extended = db.lockExtensions.some((x) => x.weekStart === weekStart(day) && (x.userId === null || x.userId === me.id));
  return (
    <div className={cx('notice lock-banner small', locked ? 'warn' : '')}>
      {locked ? <Icon.lock /> : <Icon.unlock />}
      <span>
        {locked
          ? `Week locked since ${fmtDateTime(at.toISOString())}. Entries are read-only — a Partner can extend the lock.`
          : `This week stays editable until ${fmtDateTime(at.toISOString())}${extended ? ' (extended by a Partner)' : ''}.`}
      </span>
    </div>
  );
}

function entryTitle(db: ReturnType<typeof useApp.getState>['db'], e: WorkEntry) {
  if (!e.clientId) return { code: '', title: INTERNAL_LABEL[e.internalCategory ?? 'other'] };
  const c = clientById(db, e.clientId);
  const t = taskById(db, e.taskId);
  return { code: c?.code ?? '', title: `${c?.name ?? ''} → ${t?.title ?? ''}` };
}

function DayView({ day, setDay }: { day: ISODate; setDay: (d: ISODate) => void }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const openSheet = useApp((s) => s.openSheet);
  const copyDay = useApp((s) => s.copyDay);
  const notify = useApp((s) => s.notify);
  const t = today();
  const ws = weekStart(day);
  const days = weekDates(ws);
  const entries = entriesOn(db, me.id, day);
  const total = hoursOf(entries);
  const locked = isLocked(db, me.id, day);
  const prior = [...db.entries]
    .filter((e) => e.userId === me.id && e.date < day && e.internalCategory !== 'leave')
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <div className="row between">
          <button className="icon-btn" onClick={() => setDay(addDays(day, -7))} aria-label="Previous week">
            <Icon.left />
          </button>
          <div className="strong small">Week of {fmtDate(ws)}</div>
          <button className="icon-btn" onClick={() => setDay(addDays(day, 7) > t ? t : addDays(day, 7))} disabled={ws >= weekStart(t)} aria-label="Next week">
            <Icon.right />
          </button>
        </div>
        <div className="daystrip">
          {days.map((d) => {
            const h = hoursOf(entriesOn(db, me.id, d));
            const n = entriesOn(db, me.id, d).length;
            const miss = d < t && weekday(d) !== 0 && n === 0 && d >= me.joiningDate;
            return (
              <button key={d} className={cx(d === day && 'on', miss && 'miss')} onClick={() => setDay(d)} disabled={d > t}>
                <span className="dn">{dayName(d)}</span>
                <span className="dd">{Number(d.slice(8))}</span>
                <span className="dh">{n ? fmtH(h).replace(' ', '') : miss ? '—' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <LockLine day={day} />

      <div className="card flush">
        <div className="card-head" style={{ padding: '12px 14px 0' }}>
          <h2>{day === t ? 'Today' : fmtDay(day)}</h2>
          {!locked && (
            <button className="btn primary sm" onClick={() => openSheet({ date: day })}>
              <Icon.plus /> Add work
            </button>
          )}
        </div>
        {entries.length ? (
          <div className="list">
            {entries.map((e) => {
              const { code, title } = entryTitle(db, e);
              return (
                <div key={e.id} className="entry">
                  <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, minWidth: 0 }} onClick={() => openSheet({ entryId: e.id })}>
                    <div className="ellipsis">
                      {code && <span className="mono small faint">{code} </span>}
                      <span className="strong">{title}</span>
                    </div>
                    <div className="small muted">
                      {[e.stage, e.description, e.location !== 'office' ? LOCATION_LABEL[e.location] : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {e.outcome && <div className="small" style={{ color: 'var(--ok)' }}>→ {e.outcome}</div>}
                  </button>
                  <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                    <span className="hrs">{e.internalCategory === 'leave' && e.hours === 0 ? 'Leave' : fmtH(e.hours)}</span>
                    {!locked && (
                      <button className="btn ghost sm" title="Copy entry" onClick={() => openSheet({ prefill: { ...e, outcome: undefined }, date: day === t ? t : day })}>
                        <Icon.copy />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="total-bar">
              <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {new Set(entries.filter((e) => e.clientId).map((e) => e.clientId)).size} clients</span>
              <span className="num">{fmtH(total)} logged</span>
            </div>
          </div>
        ) : (
          <Empty icon={<Icon.work />}>
            {day < t && weekday(day) !== 0 ? `You haven't logged any work for ${dayName(day, true)}.` : 'Nothing logged yet.'}
          </Empty>
        )}
      </div>

      {!locked && prior && (
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const r = copyDay(prior, day);
            notify(r.ok ? r.message ?? 'Copied' : r.error);
          }}
        >
          <Icon.copy /> Copy day from {fmtDay(prior)}
        </button>
      )}
    </div>
  );
}

function WeekView({ day, setDay, openDay }: { day: ISODate; setDay: (d: ISODate) => void; openDay: (d: ISODate) => void }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const openSheet = useApp((s) => s.openSheet);
  const t = today();
  const ws = weekStart(day);
  const all = entriesBetween(db, me.id, ws, addDays(ws, 6));
  const hasSunday = all.some((e) => weekday(e.date) === 0);
  const days = weekDates(ws, hasSunday ? 7 : 6);

  // rows: (client/task or internal category) × stage
  const rowMap = new Map<string, { key: string; label: string; code: string; stage?: string; e: WorkEntry }>();
  for (const e of all) {
    const key = `${e.taskId ?? e.internalCategory}|${e.stage ?? ''}`;
    if (!rowMap.has(key)) {
      const { code, title } = entryTitle(db, e);
      rowMap.set(key, { key, label: title, code, stage: e.stage, e });
    }
  }
  const rows = [...rowMap.values()].sort((a, b) => (a.code || 'ZZ').localeCompare(b.code || 'ZZ') || a.label.localeCompare(b.label));
  const cell = (key: string, d: ISODate) => all.filter((e) => e.date === d && `${e.taskId ?? e.internalCategory}|${e.stage ?? ''}` === key);
  const dayTotals = days.map((d) => hoursOf(all.filter((e) => e.date === d)));
  const daysLogged = dayTotals.filter((h, i) => h > 0 && days[i] <= t).length;

  return (
    <div className="stack">
      <div className="row between">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -7))} aria-label="Previous week">
          <Icon.left />
        </button>
        <div className="strong small">
          {fmtDate(ws)} – {fmtDate(addDays(ws, 5))}
        </div>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 7) > t ? t : addDays(day, 7))} disabled={ws >= weekStart(t)} aria-label="Next week">
          <Icon.right />
        </button>
      </div>
      <LockLine day={ws} />
      {rows.length ? (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col">Client · task · stage</th>
                {days.map((d) => (
                  <th key={d} className="n" style={{ textAlign: 'center' }}>
                    <button className="btn ghost sm" onClick={() => openDay(d)} disabled={d > t}>
                      {dayName(d)} {Number(d.slice(8))}
                    </button>
                  </th>
                ))}
                <th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowTotal = sum(days.map((d) => hoursOf(cell(r.key, d))));
                return (
                  <tr key={r.key}>
                    <td className="sticky-col">
                      <div className="ellipsis" style={{ maxWidth: 230 }}>
                        {r.code && <span className="mono xs faint">{r.code} </span>}
                        <span className="small strong">{r.label}</span>
                      </div>
                      {r.stage && <div className="xs muted ellipsis" style={{ maxWidth: 230 }}>{r.stage}</div>}
                    </td>
                    {days.map((d) => {
                      const es = cell(r.key, d);
                      const h = hoursOf(es);
                      const locked = isLocked(db, me.id, d);
                      return (
                        <td key={d} style={{ padding: 3 }}>
                          <button
                            className={cx('cell-btn', es.length ? 'has' : 'empty')}
                            disabled={d > t || (!es.length && locked)}
                            onClick={() => {
                              if (es.length === 1) openSheet({ entryId: es[0].id });
                              else if (es.length > 1) openDay(d);
                              else openSheet({ date: d, prefill: { clientId: r.e.clientId, taskId: r.e.taskId, engagementId: r.e.engagementId, stage: r.e.stage, internalCategory: r.e.internalCategory, location: r.e.location, hours: 1 } });
                            }}
                          >
                            {es.length ? (h === 0 && es[0].internalCategory === 'leave' ? 'L' : fmtH(h).replace(' h', '')) : d > t || locked ? '' : '+'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="n mono">{fmtH(rowTotal).replace(' h', '')}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col" style={{ background: 'var(--surface-2)' }}>Hours logged</td>
                {dayTotals.map((h, i) => (
                  <td key={days[i]} className="n mono" style={{ textAlign: 'center' }}>
                    {h ? fmtH(h).replace(' h', '') : days[i] < t ? '—' : ''}
                  </td>
                ))}
                <td className="n mono">{fmtH(sum(dayTotals)).replace(' h', '')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Icon.work />}>No work logged this week yet.</Empty>
        </div>
      )}
      <div className="muted small">
        {fmtH(sum(dayTotals))} logged across {daysLogged} day{daysLogged === 1 ? '' : 's'}
        {daysLogged ? ` · average ${(sum(dayTotals) / daysLogged).toFixed(1)} hrs/day` : ''}. Tap a cell to edit, or a blank cell to log the same work on that day.
      </div>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => openSheet({ date: t >= ws && t <= addDays(ws, 6) ? t : addDays(ws, 5) })} disabled={isLocked(db, me.id, ws)}>
        <Icon.plus /> Add a row
      </button>
    </div>
  );
}
