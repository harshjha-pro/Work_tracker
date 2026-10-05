import type { Role } from '../lib/types';
import { ROLE_LABEL } from '../lib/master';
import { visibleClientIds } from '../lib/access';
import { useApp } from '../store';
import { Avatar, Icon, Sheet } from './ui';

const ORDER: Role[] = ['partner', 'manager', 'staff', 'article', 'admin'];

export function PeoplePicker({ onPick, currentId }: { onPick: (id: string) => void; currentId?: string | null }) {
  const db = useApp((s) => s.db);
  return (
    <div className="stack-lg">
      {ORDER.map((role) => (
        <div className="stack-sm" key={role}>
          <div className="eyebrow">{ROLE_LABEL[role]}</div>
          <div className="card flush list">
            {db.users
              .filter((u) => u.role === role)
              .map((u) => {
                const n = visibleClientIds(db, u).size;
                return (
                  <button key={u.id} className="list-item" onClick={() => onPick(u.id)} aria-current={u.id === currentId}>
                    <Avatar user={u} />
                    <div className="grow">
                      <div className="strong">{u.name}</div>
                      <div className="meta">
                        {u.designation} · {role === 'partner' || role === 'admin' ? 'Firm-wide access' : n ? `${n} client${n > 1 ? 's' : ''}` : 'No clients assigned yet'}
                      </div>
                    </div>
                    {u.id === currentId ? <span className="pill accent plain">Signed in</span> : <span className="faint"><Icon.chevron /></span>}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function UserSwitcher({ onClose }: { onClose: () => void }) {
  const login = useApp((s) => s.login);
  const logout = useApp((s) => s.logout);
  const currentId = useApp((s) => s.currentUserId);
  return (
    <Sheet
      title="Switch user (testing)"
      onClose={onClose}
      footer={
        <button className="btn block" onClick={() => { logout(); onClose(); }}>
          Sign out
        </button>
      }
    >
      <p className="muted small">No passwords in this prototype. Pick anyone to see the app with their role and client-team access.</p>
      <PeoplePicker
        currentId={currentId}
        onPick={(id) => {
          login(id);
          onClose();
        }}
      />
    </Sheet>
  );
}
