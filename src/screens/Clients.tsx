import { useState } from 'react';
import { useApp, useMe } from '../store';
import { can, visibleClientIds } from '../lib/access';
import { isOverdue, derivedFlags } from '../lib/compliance';
import { CONSTITUTION_LABEL, GST_FREQ_LABEL, isOpen } from '../lib/master';
import type { Client } from '../lib/types';
import { Empty, Icon, PageHead, Pill } from '../components/ui';

export function flagSummary(c: Client): string[] {
  const f = derivedFlags(c);
  const out: string[] = [];
  if (c.profile.gstFrequency !== 'not_applicable') out.push(`GST ${GST_FREQ_LABEL[c.profile.gstFrequency].replace(' (quarterly)', '')}`);
  if (c.profile.tds) out.push('TDS');
  if (c.profile.taxAudit) out.push('Tax audit');
  if (c.profile.statutoryAudit) out.push('Stat audit');
  if (f.isCompany === 'true') out.push('ROC');
  if (f.isLLP === 'true') out.push('LLP');
  if (c.profile.advanceTax) out.push('Adv. tax');
  if (c.profile.pf || c.profile.esi) out.push([c.profile.pf && 'PF', c.profile.esi && 'ESI'].filter(Boolean).join('/'));
  return out;
}

export function Clients() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const [q, setQ] = useState('');
  const ids = visibleClientIds(db, me);
  const query = q.trim().toLowerCase();
  const list = db.clients
    .filter((c) => ids.has(c.id))
    .filter((c) => !query || c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query) || (c.group ?? '').toLowerCase().includes(query) || (c.pan ?? '').toLowerCase().includes(query))
    .sort((a, b) => a.code.localeCompare(b.code));
  const editable = can.editClientMaster(me.role);

  return (
    <div className="stack">
      <PageHead
        title={me.role === 'admin' ? 'Client Master' : me.role === 'staff' || me.role === 'article' ? 'My Clients' : 'Clients'}
        sub={`${list.length} client${list.length === 1 ? '' : 's'}${me.role === 'staff' || me.role === 'article' ? ' on your teams' : ''}`}
        actions={
          editable && (
            <button className="btn primary" onClick={() => navigate({ name: 'client-edit' })}>
              <Icon.plus /> Add client
            </button>
          )
        }
      />
      <input id="client-q" className="input" placeholder="Search name, code, group or PAN" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length ? (
        <div className="card flush list">
          {list.map((c) => {
            const tasks = db.tasks.filter((t) => t.clientId === c.id && isOpen(t.status));
            const overdue = tasks.filter((t) => isOverdue(t)).length;
            const pending = tasks.filter((t) => t.status === 'pending_from_client').length;
            return (
              <button key={c.id} className="list-item" onClick={() => navigate({ name: 'client', id: c.id })}>
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <span className="mono small faint">{c.code}</span>
                    <span className="strong ellipsis">{c.name}</span>
                  </div>
                  <div className="meta ellipsis">
                    {CONSTITUTION_LABEL[c.constitution]}
                    {c.group ? ` · ${c.group}` : ''} · {flagSummary(c).join(' · ') || 'No recurring compliances'}
                  </div>
                </div>
                <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                  {c.status !== 'active' && <Pill plain>{c.status === 'dormant' ? 'Dormant' : 'Discontinued'}</Pill>}
                  {overdue > 0 && <Pill tone="bad">{overdue} overdue</Pill>}
                  {pending > 0 && <Pill tone="warn">{pending} pending</Pill>}
                  {c.status === 'active' && !overdue && !pending && <span className="xs muted nowrap">{tasks.length} open</span>}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Icon.clients />}>{ids.size ? 'No clients match your search.' : 'You have not been assigned to any client yet.'}</Empty>
        </div>
      )}
    </div>
  );
}
