import { useState, useRef, useEffect } from 'react';
import { X, RotateCcw, Check, MousePointerClick } from 'lucide-react';
import { classifyLine } from '../lib/parser';

// Drag-and-drop (and tap-to-place) sorter: paste a block, each line becomes a
// chip, drop chips into field zones. Pre-places phone/pincode and any labeled
// lines. Custom Pointer-Event DnD (no library) so it works on touch; a
// tap-a-chip-then-tap-a-zone fallback covers devices where drag is fiddly.

export interface SortedFields { name: string; phone: string; pincode: string; line1: string; line2: string; }

type Chip = { id: string; text: string };
type ZoneKey = 'name' | 'phone' | 'pincode' | 'line1' | 'line2';
type Target = ZoneKey | 'pool';

const ZONES: { key: ZoneKey; label: string; multi: boolean }[] = [
  { key: 'name', label: 'Name', multi: false },
  { key: 'phone', label: 'Phone', multi: false },
  { key: 'pincode', label: 'Pincode', multi: false },
  { key: 'line1', label: 'Address Line 1', multi: true },
  { key: 'line2', label: 'Address Line 2', multi: true },
];
const isMulti = (k: ZoneKey) => ZONES.find((z) => z.key === k)!.multi;
const EMPTY_ZONES = (): Record<ZoneKey, Chip[]> => ({ name: [], phone: [], pincode: [], line1: [], line2: [] });

export const AddressSorter = ({ rawInitial, onApply, onClose }: {
  rawInitial: string;
  onApply: (f: SortedFields) => void;
  onClose: () => void;
}) => {
  const [raw, setRaw] = useState(rawInitial);
  const [pool, setPool] = useState<Chip[]>([]);
  const [zones, setZones] = useState<Record<ZoneKey, Chip[]>>(EMPTY_ZONES());
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ text: string; x: number; y: number } | null>(null);
  const [overZone, setOverZone] = useState<Target | null>(null);

  const idRef = useRef(0);
  const startRef = useRef<{ id: string; text: string; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => { rebuild(rawInitial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // (Re)build chips from the pasted text, pre-placing what we can.
  const rebuild = (text: string) => {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^[-=_*~.\s]+$/.test(l));
    const z = EMPTY_ZONES();
    const p: Chip[] = [];
    lines.forEach((line) => {
      const { text: t, zone } = classifyLine(line);
      if (!t) return;
      const chip: Chip = { id: 'c' + idRef.current++, text: t };
      if (zone === '' || zone === 'state') { if (zone === '') p.push(chip); return; } // state derived later
      const zk = zone as ZoneKey;
      if (isMulti(zk) || z[zk].length === 0) z[zk] = [...z[zk], chip];
      else p.push(chip); // single zone already filled → pool
    });
    setZones(z); setPool(p); setSelected(null);
  };

  // Move a chip (from anywhere) to a target zone or back to the pool.
  const place = (chipId: string, target: Target) => {
    const z = { ...zones };
    let p = pool.slice();
    let moving: Chip | undefined;
    const pi = p.findIndex((c) => c.id === chipId);
    if (pi >= 0) { moving = p[pi]; p.splice(pi, 1); }
    else {
      for (const k of Object.keys(z) as ZoneKey[]) {
        const i = z[k].findIndex((c) => c.id === chipId);
        if (i >= 0) { moving = z[k][i]; z[k] = z[k].filter((c) => c.id !== chipId); break; }
      }
    }
    if (!moving) return;
    if (target === 'pool') p.push(moving);
    else if (isMulti(target)) z[target] = [...z[target], moving];
    else { p = p.concat(z[target]); z[target] = [moving]; } // single → bump previous to pool
    setZones(z); setPool(p); setSelected(null);
  };

  const zoneAt = (x: number, y: number): Target | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const box = el?.closest('[data-zone]') as HTMLElement | null;
    return (box?.getAttribute('data-zone') as Target) || null;
  };

  // Pointer DnD with a movement threshold so a quick tap still selects.
  const onDown = (e: React.PointerEvent, chip: Chip) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { id: chip.id, text: chip.text, x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    s.moved = true;
    setDrag({ text: s.text, x: e.clientX, y: e.clientY });
    setOverZone(zoneAt(e.clientX, e.clientY));
  };
  const onUp = (e: React.PointerEvent, chip: Chip) => {
    const s = startRef.current;
    startRef.current = null;
    setDrag(null); setOverZone(null);
    if (s && s.moved) {
      const target = zoneAt(e.clientX, e.clientY);
      if (target) place(s.id, target);
    } else {
      setSelected((prev) => (prev === chip.id ? null : chip.id)); // tap to select/deselect
    }
  };

  const onZoneClick = (target: Target) => { if (selected) place(selected, target); };

  const reset = () => {
    setPool([...pool, ...ZONES.flatMap((z) => zones[z.key])]);
    setZones(EMPTY_ZONES());
    setSelected(null);
  };

  const apply = () => {
    const join = (arr: Chip[], sep: string) => arr.map((c) => c.text.trim()).filter(Boolean).join(sep);
    onApply({
      name: join(zones.name, ' '),
      phone: join(zones.phone, ' '),
      pincode: join(zones.pincode, ' '),
      line1: join(zones.line1, ', '),
      line2: join(zones.line2, ', '),
    });
  };

  const renderChip = (chip: Chip, inZone: boolean) => {
    const sel = selected === chip.id;
    return (
      <span key={chip.id}
        onPointerDown={(e) => onDown(e, chip)}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e, chip)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem', maxWidth: '100%',
          padding: '0.35rem 0.6rem', borderRadius: 999, cursor: 'grab', userSelect: 'none', touchAction: 'none',
          fontSize: '0.82rem', fontWeight: 600,
          background: sel ? 'var(--primary-color)' : inZone ? 'var(--primary-light)' : '#e2e8f0',
          color: sel ? '#fff' : inZone ? 'var(--primary-color)' : '#334155',
          border: sel ? '2px solid var(--primary-color)' : '2px solid transparent',
          boxShadow: drag && startRef.current?.id === chip.id ? '0 0 0 2px var(--primary-color)' : 'none',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chip.text}</span>
        <button onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); place(chip.id, 'pool'); }}
          title="Send back to list" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'inherit', opacity: inZone ? 0.8 : 0.4 }}>
          <X size={14} />
        </button>
      </span>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.75rem' }}>
      <div className="glass-card slide-up modal-card" style={{ width: '100%', maxWidth: 640, background: 'white', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Fill Address</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div className="input-group" style={{ margin: '0 0 0.75rem' }}>
          <label className="input-label">Enter address text</label>
          <textarea className="input-field" style={{ minHeight: 70 }} value={raw}
            onChange={(e) => { setRaw(e.target.value); rebuild(e.target.value); }} placeholder="Paste the order message…" />
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <MousePointerClick size={14} /> Drag a chip into a field — or tap a chip, then tap a field.
        </p>

        {/* Unassigned chip pool */}
        <div data-zone="pool" onClick={() => onZoneClick('pool')}
          style={{ minHeight: 52, display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignContent: 'flex-start',
            padding: '0.6rem', marginBottom: '1rem', borderRadius: 'var(--radius-md)',
            border: `2px dashed ${overZone === 'pool' ? 'var(--primary-color)' : 'var(--border-color)'}`,
            background: overZone === 'pool' ? 'var(--primary-light)' : 'var(--bg-color)' }}>
          {pool.length === 0
            ? <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>All lines placed — or paste above.</span>
            : pool.map((c) => renderChip(c, false))}
        </div>

        {/* Field zones */}
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {ZONES.map((zd) => {
            const active = overZone === zd.key || (!!selected);
            return (
              <div key={zd.key} data-zone={zd.key} onClick={() => onZoneClick(zd.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-md)',
                  border: `2px ${overZone === zd.key ? 'solid' : 'dashed'} ${overZone === zd.key ? 'var(--primary-color)' : active ? 'var(--primary-light)' : 'var(--border-color)'}`,
                  background: overZone === zd.key ? 'var(--primary-light)' : '#fff', cursor: selected ? 'pointer' : 'default' }}>
                <span style={{ flex: '0 0 110px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{zd.label}</span>
                <div style={{ flex: 1, minHeight: 34, display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                  {zones[zd.key].length === 0
                    ? <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{selected ? 'tap to place here' : 'drop here'}</span>
                    : zones[zd.key].map((c) => renderChip(c, true))}
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0' }}>
          State is filled automatically from the pincode. Pick the Product back on the form.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={reset}><RotateCcw size={16} /> Reset</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={apply}><Check size={16} /> Fill form</button>
        </div>
      </div>

      {/* Drag ghost */}
      {drag && (
        <div style={{ position: 'fixed', left: drag.x, top: drag.y, transform: 'translate(-50%, -130%)', pointerEvents: 'none', zIndex: 4000,
          padding: '0.35rem 0.6rem', borderRadius: 999, background: 'var(--primary-color)', color: '#fff', fontSize: '0.82rem', fontWeight: 600,
          boxShadow: '0 6px 18px rgba(0,0,0,0.25)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {drag.text}
        </div>
      )}
    </div>
  );
};
