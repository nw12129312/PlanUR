import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { Button, TextInput } from './bits.jsx';

export function PlansModal({ index, currentId, onLoad, onRename, onDuplicate, onDelete, onClose, onNew }) {
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Saved plans" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Saved plans</h2>
          <div className="flex gap-2">
            <Button kind="primary" onClick={onNew}>{<Icon name="plus" size="sm" />} New plan</Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
        {index.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-3">No saved plans yet. Use “Save” in the header.</p>
        )}
        <ul className="space-y-2">
          {index.map((e) => (
            <li key={e.id} className={`rounded-lg border p-2.5 ${e.id === currentId ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              {renaming === e.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={(ev) => { ev.preventDefault(); onRename(e.id, name.trim() || e.name); setRenaming(null); }}
                >
                  <TextInput autoFocus value={name} onChange={(ev) => setName(ev.target.value)} className="flex-1" aria-label="New plan name" />
                  <Button kind="primary" type="submit" onClick={() => { onRename(e.id, name.trim() || e.name); setRenaming(null); }}>Save</Button>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {e.last_edited ? new Date(e.last_edited).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-2">
                    {[e.major, e.minor, (e.clusters || []).join(' + ')].filter(Boolean).join(' · ') || 'No programs selected'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.id !== currentId && <Button onClick={() => onLoad(e.id)}>Open</Button>}
                    <Button onClick={() => { setRenaming(e.id); setName(e.name); }}>Rename</Button>
                    <Button onClick={() => onDuplicate(e.id)}>Duplicate</Button>
                    <Button kind="danger" onClick={() => onDelete(e.id)}>Delete</Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
