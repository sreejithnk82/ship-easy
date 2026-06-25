import { LabelFormat, PaperKey, PAPER_OPTIONS, PER_PAGE_OPTIONS } from '../lib/labelFormat';

// Two dropdowns: paper/label size + labels per page. Controlled; the parent
// persists the choice via labelFormat.ts.
export const LabelFormatPicker = ({ value, onChange }: { value: LabelFormat; onChange: (f: LabelFormat) => void }) => (
  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
    <div className="input-group" style={{ margin: 0 }}>
      <label className="input-label">Label size</label>
      <select className="input-field" value={value.paper} onChange={(e) => onChange({ ...value, paper: e.target.value as PaperKey })} style={{ width: 'auto' }}>
        {PAPER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
    <div className="input-group" style={{ margin: 0 }}>
      <label className="input-label">Labels / page</label>
      <select className="input-field" value={value.perPage} onChange={(e) => onChange({ ...value, perPage: Number(e.target.value) })} style={{ width: 'auto' }}>
        {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  </div>
);
