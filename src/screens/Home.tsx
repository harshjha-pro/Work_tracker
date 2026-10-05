import { useMemo } from 'react';
import { useApp, useMe } from '../store';
import { visibleClientIds, visibleTasks, can, visiblePeople } from '../lib/access';
import { addDays, dayName, diffDays, fmtDate, fmtDay, monthName, toDate, today, weekStart } from '../lib/dates';
import { isOverdue } from '../lib/compliance';
import { isOpen } from '../lib/master';
import { clientById, entriesBetween, entriesOn, hoursOf, missingDays, firstName } from '../lib/selectors';
import { cx } from '../lib/util';
import { Icon, StatusPill, fmtH } from '../components/ui';
import type { Task } from '../lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DueRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const db = useApp((s) => s.db);
  const d = toDate(task.effectiveDue);
  const overdue = isOverdue(task);
  const client = clientById(db, task.clientId);
  return (
    <button className="list-item due-row" onClick={onClick}>
      <div className={cx('due-date', overdue && 'bad')}>
        <div className="d">{d.getDate()}</div>
        <div className="m">{monthName(d.getMonth() + 1)}</div>
      </div>
      <div className="grow">
        <div className="strong ellipsis">{task.title}</div>
        <div className="meta ellipsis">
          <span className="mono">{client?.code}</span> · {client?.name}
        </div>
      </div>
      <StatusPill task={task} />
    </button>
  );
}

export function Home() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const openSheet = useApp((s) => s.openSheet);
  const t = today();

  const clientsVisible = visibleClientIds(db, me);
  const allocationsPending = (me.role === 'staff' || me.role === 'article') && clientsVisible.size === 0;

  const todays = entriesOn(db, me.id, t);
  const hoursToday = hoursOf(todays);
  const clientsTouched = new Set(todays.filter((e) => e.clientId).map((e) => e.clientId)).size;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const myChangesToday = db.tasks.flatMap((x) => x.statusHistory.filter((h) => h.by === me.id && new Date(h.at) >= startOfToday).map((h) => ({ task: x, h })));
  const movedForward = new Set([...todays.filter((e) => e.taskId).map((e) => e.taskId), ...myChangesToday.map((c) => c.task.id)]).size;
  const filingsToday = myChangesToday.filter((c) => c.h.to === 'filed' || c.h.to === 'filed_late').length;

  const ws = weekStart(t);
  const weekEntries = entriesBetween(db, me.id, ws, t);
  const daysWithWork = new Set(weekEntries.filter((e) => e.hours > 0).map((e) => e.date)).size;
  const avg = daysWithWork ? hoursOf(weekEntries) / daysWithWork : 0;
  const missing = missingDays(db, me, addDays(t, -7)).slice(-2).reverse();

  const scoped = visibleTasks(db, me);
  const mine = scoped.filter((x) => x.assignedTo === me.id || (x.checkerId === me.id && x.status === 'under_review'));
  const dueWeek = useMemo(
    () =>
      mine
        .filter((x) => isOpen(x.status) && diffDays(x.effectiveDue, t) <= 7)
        .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.effectiveDue.localeCompare(b.effectiveDue)),
    [mine, t],
  );

  const showFirm = me.role === 'partner' || me.role === 'manager';
  const firmOpen = scoped.filter((x) => isOpen(x.status));
  const firmDue = firmOpen.filter((x) => x.effectiveDue >= t && diffDays(x.effectiveDue, t) <= 7).length;
  const firmOverdue = firmOpen.filter((x) => isOverdue(x)).length;
  const firmPending = firmOpen.filter((x) => x.status === 'pending_from_client').length;
  const reviewQueue = scoped.filter((x) => x.status === 'under_review' && x.checkerId === me.id);
  const people = can.viewTeam(me.role) ? visiblePeople(db, me).filter((u) => u.id !== me.id && u.role !== 'admin') : [];
  const incomplete = people.filter((u) => missingDays(db, u, addDays(ws, -7), addDays(t, -1)).length > 0).length;

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h1>
          {greeting()}, {firstName(me)}
        </h1>
        <div className="muted">
          {dayName(t, true)}, {fmtDate(t)}
        </div>
      </div>

      {allocationsPending ? (
        <div className="card stack">
          <span className="pill info">Allocations Pending</span>
          <h2>You're not on a client team yet</h2>
          <p className="muted">
            Your Manager or the Practice Admin will add you to client teams. Until then you can log internal time — articleship classes, training,
            knowledge updates — and it counts like any other work.
          </p>
          <button className="add-work" onClick={() => openSheet({ prefill: { internalCategory: 'training_cpe' } })}>
            <Icon.plus /> Add Work
          </button>
        </div>
      ) : (
        <button className="add-work" onClick={() => openSheet({})}>
          <Icon.plus /> Add Work
        </button>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>Today</h2>
          <button className="btn ghost sm" onClick={() => navigate({ name: 'work', date: t })}>
            Today's work <Icon.chevron />
          </button>
        </div>
        <div className="snapshot">
          <div className="stat">
            <div className="v">{fmtH(hoursToday)}</div>
            <div className="l">Hours logged</div>
          </div>
          <div className="stat">
            <div className="v">{clientsTouched}</div>
            <div className="l">Clients touched</div>
          </div>
          <div className="stat">
            <div className="v">{movedForward}</div>
            <div className="l">Tasks moved forward</div>
          </div>
          <div className="stat">
            <div className="v">{filingsToday}</div>
            <div className="l">Filings completed</div>
          </div>
        </div>
        {avg > 0 && <div className="muted small">Your average this week: {avg.toFixed(1)} hrs/day</div>}
        {missing.map((d) => (
          <div key={d} className="notice warn row between">
            <span>You haven't logged any work for {dayName(d, true)} {fmtDay(d).split(' ').slice(1).join(' ')}.</span>
            <button className="btn sm" onClick={() => openSheet({ date: d })}>
              Log it
            </button>
          </div>
        ))}
      </section>

      {showFirm && (
        <section className="stack">
          <div className="section-head">
            <h2>{me.role === 'partner' ? 'Firm compliance' : 'Your portfolio'}</h2>
            <button className="btn ghost sm" onClick={() => navigate({ name: 'team' })}>
              This week <Icon.chevron />
            </button>
          </div>
          <div className="strip">
            <button onClick={() => navigate({ name: 'tasks', filter: 'week' })}>
              <div className="v">{firmDue}</div>
              <div className="small muted">Due this week</div>
            </button>
            <button onClick={() => navigate({ name: 'tasks', filter: 'overdue' })}>
              <div className={cx('v')} style={{ color: firmOverdue ? 'var(--bad)' : undefined }}>
                {firmOverdue}
              </div>
              <div className="small muted">Overdue</div>
            </button>
            <button onClick={() => navigate({ name: 'tasks', filter: 'pending' })}>
              <div className="v" style={{ color: firmPending ? 'var(--warn)' : undefined }}>
                {firmPending}
              </div>
              <div className="small muted">Pending from client</div>
            </button>
          </div>
          {incomplete > 0 && (
            <div className="muted small">
              {incomplete} {incomplete === 1 ? 'person has' : 'people have'} days without entries in the last two weeks.
            </div>
          )}
        </section>
      )}

      {reviewQueue.length > 0 && (
        <section className="stack">
          <h2>Waiting for your review</h2>
          <div className="card flush list">
            {reviewQueue.map((x) => (
              <DueRow key={x.id} task={x} onClick={() => navigate({ name: 'task', id: x.id })} />
            ))}
          </div>
        </section>
      )}

      {!allocationsPending && (
        <section className="stack">
          <div className="section-head">
            <h2>Due this week</h2>
            <button className="btn ghost sm" onClick={() => navigate({ name: 'tasks' })}>
              My tasks <Icon.chevron />
            </button>
          </div>
          {dueWeek.length ? (
            <div className="card flush list">
              {dueWeek.map((x) => (
                <DueRow key={x.id} task={x} onClick={() => navigate({ name: 'task', id: x.id })} />
              ))}
            </div>
          ) : (
            <div className="card muted small">Nothing assigned to you falls due in the next 7 days.</div>
          )}
        </section>
      )}

      <section className="row-wrap">
        <button className="btn" onClick={() => navigate({ name: 'work', view: 'week' })}>
          <Icon.work /> This week
        </button>
        <button className="btn" onClick={() => navigate({ name: 'calendar' })}>
          <Icon.calendar /> Calendar
        </button>
        {can.editClientMaster(me.role) && (
          <button className="btn" onClick={() => navigate({ name: 'client-edit' })}>
            <Icon.clients /> Add client
          </button>
        )}
        {can.editDueDateMaster(me.role) && (
          <button className="btn" onClick={() => navigate({ name: 'master' })}>
            <Icon.master /> Due-Date Master
          </button>
        )}
      </section>
    </div>
  );
}
