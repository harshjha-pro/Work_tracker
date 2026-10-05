import { useApp, useMe } from '../store';
import { can, visibleClientIds } from '../lib/access';
import { isOpen, isFiled, SERVICE_LINE_LABEL } from '../lib/master';
import { fmtDate } from '../lib/dates';
import { budgetSignal, clientById, engagementHours, templateByCode, userById } from '../lib/selectors';
import { groupBy, sum } from '../lib/util';
import { Empty, Icon, PageHead, Pill, BudgetBar, fmtH } from '../components/ui';
import { DueRow } from './Home';

export function EngagementDetail({ id }: { id: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const setStatus = useApp((s) => s.setEngagementStatus);
  const eng = db.engagements.find((e) => e.id === id);
  if (!eng || !visibleClientIds(db, me).has(eng.clientId)) {
    return (
      <div>
        <PageHead title="Engagement" back />
        <div className="card"><Empty>Not available.</Empty></div>
      </div>
    );
  }
  const client = clientById(db, eng.clientId)!;
  const tpl = templateByCode(db, eng.templateCode)!;
  const tasks = db.tasks.filter((t) => t.engagementId === id).sort((a, b) => a.effectiveDue.localeCompare(b.effectiveDue));
  const entries = db.entries.filter((e) => e.engagementId === id);
  const used = engagementHours(db, id);
  const staffView = me.role === 'staff' || me.role === 'article';
  const manager = can.manageEngagements(me.role);
  const byPerson = Object.entries(groupBy(entries, (e) => e.userId)).map(([uid, es]) => ({ user: userById(db, uid), h: sum(es.map((e) => e.hours)) })).sort((a, b) => b.h - a.h);
  const byStage = Object.entries(groupBy(entries.filter((e) => e.stage), (e) => e.stage!)).map(([stage, es]) => ({ stage, h: sum(es.map((e) => e.hours)) }));
  byStage.sort((a, b) => tpl.stages.indexOf(a.stage) - tpl.stages.indexOf(b.stage));
  const maxStage = Math.max(1, ...byStage.map((s) => s.h));
  const sig = eng.type === 'one_time' ? budgetSignal(used, eng.budgetHours) : null;
  const periodBudget = eng.type === 'recurring' ? eng.budgetHours : undefined;
  const overrunPeriods = eng.type === 'recurring' && periodBudget ? tasks.filter((t) => sum(entries.filter((e) => e.taskId === t.id).map((e) => e.hours)) > periodBudget).length : 0;
  const myHours = sum(entries.filter((e) => e.userId === me.id).map((e) => e.hours));

  return (
    <div className="stack-lg">
      <PageHead
        back
        title={eng.title}
        sub={
          <button className="btn ghost sm" style={{ padding: 0, minHeight: 0 }} onClick={() => navigate({ name: 'client', id: client.id })}>
            <span className="mono">{client.code}</span>&nbsp;{client.name}
          </button>
        }
        actions={
          manager && (
            <>
              {eng.status === 'active' && eng.type === 'one_time' && (
                <button className="btn" onClick={() => setStatus(id, 'completed')}>Mark completed</button>
              )}
              {eng.status !== 'active' && <button className="btn" onClick={() => setStatus(id, 'active')}>Reactivate</button>}
              <button className="btn primary" onClick={() => navigate({ name: 'engagement-edit', id })}>
                <Icon.edit /> Edit & team
              </button>
            </>
          )
        }
      />
      <div className="row-wrap">
        <Pill tone="accent" plain>{SERVICE_LINE_LABEL[eng.serviceLine]}</Pill>
        <Pill plain>{eng.type === 'recurring' ? 'Recurring' : 'One-time'}</Pill>
        {eng.status !== 'active' && <Pill tone="warn" plain>{eng.status.replace('_', ' ')}</Pill>}
        {sig && !staffView && <Pill tone={sig.tone === 'ok' ? 'ok' : sig.tone}>{sig.health} · {sig.label}</Pill>}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Financial year</dt><dd>{eng.financialYear ?? '—'}</dd>
            <dt>Stage template</dt><dd>{tpl.name}</dd>
            <dt>Dates</dt><dd>{eng.startDate ? fmtDate(eng.startDate) : '—'} – {eng.endDate ? fmtDate(eng.endDate) : '—'}</dd>
            <dt>Partner</dt><dd>{userById(db, eng.partnerId)?.name}</dd>
            <dt>Manager</dt><dd>{userById(db, eng.managerId)?.name ?? '—'}</dd>
            <dt>Team</dt>
            <dd>{eng.team.map((m) => `${userById(db, m.userId)?.name} (${m.role})`).join(', ') || '—'}</dd>
            {can.seeBilling(me.role) && (<><dt>Billable</dt><dd>{eng.billable ? 'Chargeable' : 'Non-chargeable'} <span className="xs muted">· set by Partner</span></dd></>)}
          </dl>
        </div>
        <div className="card stack">
          <h2>Hours</h2>
          {eng.type === 'one_time' ? (
            <BudgetBar used={used} budget={eng.budgetHours} staffView={staffView} />
          ) : (
            <div className="small muted">
              Engagement Budget per period: {periodBudget ? fmtH(periodBudget) : '—'}
              {!staffView && overrunPeriods > 0 ? ` · ${overrunPeriods} period(s) over budget` : ''}
            </div>
          )}
          {staffView ? (
            <div className="small">You have logged <strong>{fmtH(myHours)}</strong> here · team total {fmtH(used)}.</div>
          ) : (
            <>
              <div className="eyebrow">By person</div>
              {byPerson.length ? byPerson.map((p) => (
                <div key={p.user?.id} className="row between small"><span>{p.user?.name}</span><span className="num mono">{fmtH(p.h)}</span></div>
              )) : <div className="muted small">No hours logged yet.</div>}
            </>
          )}
          {byStage.length > 0 && (
            <>
              <div className="eyebrow">By stage</div>
              {byStage.map((s) => (
                <div key={s.stage} className="bar-h small">
                  <span style={{ width: 140 }} className="ellipsis">{s.stage}</span>
                  <span className="track"><span style={{ width: `${(s.h / maxStage) * 100}%`, background: 'var(--accent)' }} /></span>
                  <span className="mono num" style={{ width: 52, textAlign: 'right' }}>{fmtH(s.h)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <section className="stack">
        <h2>{eng.type === 'recurring' ? 'Compliance tasks' : 'Work item'}</h2>
        {tasks.length ? (
          <div className="card flush list">
            {tasks.filter((t) => isOpen(t.status)).concat(tasks.filter((t) => isFiled(t.status) || t.status === 'not_applicable').reverse()).map((t) => (
              <DueRow key={t.id} task={t} onClick={() => navigate({ name: 'task', id: t.id })} />
            ))}
          </div>
        ) : (
          <div className="card muted small">No tasks yet.</div>
        )}
      </section>
    </div>
  );
}
