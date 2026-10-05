import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { StageTemplate } from '../lib/types';
import { can } from '../lib/access';
import { ACK_LABEL } from '../lib/master';
import { Empty, Field, PageHead, Sheet } from '../components/ui';

export function Templates() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const [edit, setEdit] = useState<StageTemplate | null>(null);
  if (!can.editTemplates(me.role)) {
    return (
      <div>
        <PageHead title="Stage Templates" />
        <div className="card"><Empty>Admin maintains stage templates.</Empty></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHead title="Stage Templates" sub="Stages and default document checklists per engagement type. New services need no code changes." />
      <div className="card flush list">
        {db.templates.map((t) => (
          <button key={t.code} className="list-item" onClick={() => setEdit(t)}>
            <div className="grow">
              <div className="strong">{t.name}</div>
              <div className="meta">{t.stages.join(' → ')}</div>
              <div className="xs faint">
                {t.filingStageIndex !== null ? `Closes with ${ACK_LABEL[t.ackType ?? 'other']} at “${t.stages[t.filingStageIndex]}”` : 'No acknowledgment'} · Review: {t.reviewLevel} · {t.checklist.length} checklist items
              </div>
            </div>
          </button>
        ))}
      </div>
      {edit && <EditTemplate t={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditTemplate({ t, onClose }: { t: StageTemplate; onClose: () => void }) {
  const update = useApp((s) => s.updateTemplate);
  const notify = useApp((s) => s.notify);
  const [stages, setStages] = useState(t.stages.join('\n'));
  const [checklist, setChecklist] = useState(t.checklist.join('\n'));
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <Sheet
      title={t.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            disabled={lines(stages).length < 2}
            onClick={() => {
              update(t.code, { stages: lines(stages), checklist: lines(checklist) });
              notify('Template saved');
              onClose();
            }}
          >
            Save template
          </button>
        </>
      }
    >
      <Field label="Stages, one per line" hint={t.filingStageIndex !== null ? `Stage ${t.filingStageIndex + 1} records the ${ACK_LABEL[t.ackType ?? 'other']}.` : undefined} htmlFor="tpl-stages">
        <textarea id="tpl-stages" className="input" rows={8} value={stages} onChange={(e) => setStages(e.target.value)} />
      </Field>
      <Field label="Default document checklist, one per line" hint="Applies to tasks created from now on; Managers can edit per task." htmlFor="tpl-check">
        <textarea id="tpl-check" className="input" rows={6} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
      </Field>
    </Sheet>
  );
}
