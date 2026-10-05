import { useState } from 'react';
import { useApp, useMe } from '../store';
import { can, visibleClientIds } from '../lib/access';
import { derivedFlags, typeApplies } from '../lib/compliance';
import { CONSTITUTION_LABEL, isFiled, isOpen, SERVICE_LINE_LABEL } from '../lib/master';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { engagementHours, userById, budgetSignal } from '../lib/selectors';
import { Empty, Icon, PageHead, Pill, Seg, fmtH } from '../components/ui';
import { DueRow } from './Home';
import { flagSummary } from './Clients';

type Tab = 'overview' | 'compliance' | 'engagements' | 'history';

export function ClientDetail({ id, tab }: { id: string; tab?: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const [t, setT] = useState<Tab>((tab as Tab) ?? 'overview');
  const client = db.clients.find((c) => c.id === id);
  if (!client || !visibleClientIds(db, me).has(id)) {
    return (
      <div>
        <PageHead title="Client" back />
        <div className="card"><Empty>This client isn't on any of your teams.</Empty></div>
      </div>
    );
  }
  const team = db.clientTeam.filter((a) => a.clientId === id);
  const tasks = db.tasks.filter((x) => x.clientId === id);
  const open = tasks.filter((x) => isOpen(x.status)).sort((a, b) => a.effectiveDue.localeCompare(b.effectiveDue));
  const done = tasks.filter((x) => isFiled(x.status)).sort((a, b) => b.effectiveDue.localeCompare(a.effectiveDue));
  const engagements = db.engagements.filter((e) => e.clientId === id);
  const flags = derivedFlags(client);
  const applicable = db.complianceTypes.filter((ct) => typeApplies(ct, client));
  const staffView = me.role === 'staff' || me.role === 'article';

  return (
    <div className="stack-lg">
      <PageHead
        back
        title={client.name}
        sub={
          <>
            <span className="mono">{client.code}</span> · {CONSTITUTION_LABEL[client.constitution]}
            {client.group ? ` · ${client.group}` : ''}
          </>
        }
        actions={
          <>
            {can.manageEngagements(me.role) && (
              <button className="btn" onClick={() => navigate({ name: 'engagement-edit', clientId: id })}>
                <Icon.plus /> Engagement
              </button>
            )}
            {can.editClientMaster(me.role) && (
              <button className="btn primary" onClick={() => navigate({ name: 'client-edit', id })}>
                <Icon.edit /> Edit client & flags
              </button>
            )}
          </>
        }
      />
      <div className="row-wrap">
        {client.status !== 'active' && <Pill tone="warn">{client.status === 'dormant' ? 'Dormant' : 'Discontinued'}</Pill>}
        {flagSummary(client).map((f) => (
          <Pill key={f} tone="accent" plain>{f}</Pill>
        ))}
      </div>
      <Seg<Tab>
        value={t}
        onChange={setT}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'compliance', label: `Compliance (${open.length})` },
          { value: 'engagements', label: 'Engagements' },
          { value: 'history', label: 'History' },
        ]}
      />

      {t === 'overview' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card stack">
            <h2>Identifiers</h2>
            <dl className="kv">
              <dt>PAN</dt><dd className="mono">{client.pan ?? '—'}</dd>
              <dt>TAN</dt><dd className="mono">{client.tan ?? '—'}</dd>
              <dt>GSTIN</dt><dd className="mono">{client.gstins.join(', ') || '—'}</dd>
              <dt>{flags.isLLP === 'true' ? 'LLPIN' : 'CIN'}</dt><dd className="mono">{client.cin ?? '—'}</dd>
              <dt>Udyam</dt><dd className="mono">{client.udyam ?? '—'}</dd>
              <dt>FY end</dt><dd>31 March</dd>
              {flags.isCompany === 'true' && (<><dt>AGM date</dt><dd>{client.agmDate ? fmtDate(client.agmDate) : 'Not recorded (ROC dates provisional)'}</dd></>)}
              <dt>Books by</dt><dd>{client.booksBy === 'firm' ? 'Firm' : 'Client'}</dd>
            </dl>
          </div>
          <div className="card stack">
            <h2>Team & contact</h2>
            <dl className="kv">
              <dt>Partner</dt><dd>{userById(db, client.partnerId)?.name}</dd>
              <dt>Manager</dt><dd>{userById(db, client.managerId)?.name ?? '—'}</dd>
              <dt>Team</dt>
              <dd>
                {team.length
                  ? team.map((a) => `${userById(db, a.userId)?.name}${a.role === 'reviewer' ? ' (reviewer)' : ''}`).join(', ')
                  : 'No one assigned'}
              </dd>
              <dt>Contact</dt><dd>{client.contactName ?? '—'}</dd>
              <dt>Phone</dt><dd>{client.contactPhone ?? '—'}</dd>
              <dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{client.contactEmail ?? '—'}</dd>
            </dl>
          </div>
          <div className="card stack" style={{ gridColumn: '1 / -1' }}>
            <h2>Compliances that apply</h2>
            {applicable.length ? (
              <div className="chips">
                {applicable.map((ct) => <span key={ct.code} className="pill plain">{ct.name}</span>)}
              </div>
            ) : (
              <div className="muted small">{client.status === 'active' ? 'No recurring compliances from the current flags.' : 'Client is not active — no compliances generated.'}</div>
            )}
          </div>
        </div>
      )}

      {t === 'compliance' && (
        <div className="stack">
          <h2>Open ({open.length})</h2>
          {open.length ? (
            <div className="card flush list">{open.map((x) => <DueRow key={x.id} task={x} onClick={() => navigate({ name: 'task', id: x.id })} />)}</div>
          ) : (
            <div className="card muted small">Nothing open.</div>
          )}
          <h2>Filed ({done.length})</h2>
          {done.length ? (
            <div className="card flush list">{done.slice(0, 20).map((x) => <DueRow key={x.id} task={x} onClick={() => navigate({ name: 'task', id: x.id })} />)}</div>
          ) : (
            <div className="card muted small">No filings recorded yet.</div>
          )}
        </div>
      )}

      {t === 'engagements' && (
        <div className="card flush list">
          {engagements.length ? (
            engagements
              .sort((a, b) => (b.financialYear ?? '').localeCompare(a.financialYear ?? '') || a.title.localeCompare(b.title))
              .map((e) => {
                const used = engagementHours(db, e.id);
                const sig = e.type === 'one_time' ? budgetSignal(used, e.budgetHours) : null;
                return (
                  <button key={e.id} className="list-item" onClick={() => navigate({ name: 'engagement', id: e.id })}>
                    <div className="grow">
                      <div className="strong ellipsis">{e.title}</div>
                      <div className="meta">
                        {SERVICE_LINE_LABEL[e.serviceLine]} · {e.type === 'recurring' ? 'Recurring' : 'One-time'} · {fmtH(used)} logged
                      </div>
                    </div>
                    {e.status !== 'active' && <Pill plain>{e.status}</Pill>}
                    {sig && !staffView && <Pill tone={sig.tone === 'ok' ? 'ok' : sig.tone}>{sig.health}</Pill>}
                  </button>
                );
              })
          ) : (
            <Empty>No engagements yet.</Empty>
          )}
        </div>
      )}

      {t === 'history' && (
        <div className="card stack">
          <h2>Applicability flag history</h2>
          {client.flagHistory.length ? (
            <div className="timeline">
              {[...client.flagHistory].reverse().map((h, i) => (
                <div key={i} className="t-item">
                  <span className="t-dot" />
                  <div>
                    <div>{h.flag}: {h.oldValue} → <strong>{h.newValue}</strong></div>
                    <div className="xs faint">{fmtDateTime(h.at)} · {userById(db, h.by)?.name}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted small">No flag changes since the client was added on {fmtDate(client.createdAt.slice(0, 10))}.</div>
          )}
        </div>
      )}
    </div>
  );
}
