import { LabelFormat, PaperKey, PAPER_OPTIONS, perPageOptionsFor, defaultPerPageFor } from '../lib/labelFormat';

// Paper/label size + (for A4) labels per page. Controlled; the parent persists
// the choice via labelFormat.ts. The Labels/page control is hidden for dedicated
// label sizes (always 1 per page) and only shown for A4 (2/4/6/8-up).
export const LabelFormatPicker = ({ value, onChange }: { value: LabelFormat; onChange: (f: LabelFormat) => void }) => {
  const perOptions = perPageOptionsFor(value.paper);

  const changePaper = (paper: PaperKey) => {
    const opts = perPageOptionsFor(paper);
    const perPage = opts.includes(value.perPage) ? value.perPage : defaultPerPageFor(paper);
    onChange({ paper, perPage });
  };

  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="input-group" style={{ margin: 0 }}>
        <label className="input-label">Label size</label>
        <select className="input-field" value={value.paper} onChange={(e) => changePaper(e.target.value as PaperKey)} style={{ width: 'auto' }}>
          {PAPER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>
      {perOptions.length > 1 && (
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Labels / page</label>
          <select className="input-field" value={value.perPage} onChange={(e) => onChange({ ...value, perPage: Number(e.target.value) })} style={{ width: 'auto' }}>
            {perOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
    </div>
  );
};
