import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Save, Plus, X, Pencil, Trash2, MapPin, BadgeCheck, Clock, Tag } from 'lucide-react';
import { api, Product, SenderAddress } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile, isAdmin } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { NEW_ADDRESS_KEY } from './Addresses';
import { useToast, useConfirm } from '../components/feedback';

const EMPTY = {
  name: '', nickname: '', senderAddressId: '',
  content: 'OTHERS', description: '', declaredValue: '',
  weightG: '', lengthCm: '', widthCm: '', heightCm: '',
  variants: '', // sub-type labels, comma/newline separated (e.g. "Red, Blue, 100ml")
};
type FormState = typeof EMPTY;

// Split the free-text variants box into clean labels (comma or newline separated).
const parseVariants = (s: string): string[] =>
  s.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);

// Sentinel value for the "+ Add new address…" option in the sender dropdown.
const ADD_NEW = '__add_new__';
// Where we park the in-progress product form while the user nips off to add an
// address, so they come back to exactly what they were typing.
const DRAFT_KEY = 'shipeasy.draftProduct';

export const Products = () => {
  const profile = useProfile();
  const navigate = useNavigate();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;
  // Members can add/edit products (they start "pending"); admins & superadmins
  // can verify, and delete.
  const canManage = profile?.role === 'member' || isAdmin(profile);
  const canVerify = isAdmin(profile);
  const notify = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [addresses, setAddresses] = useState<SenderAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showVariantEditor, setShowVariantEditor] = useState(false);

  useEffect(() => { if (customerId) load(); else { setProducts([]); setLoading(false); } }, [customerId]);

  // Coming back from the Addresses page: restore the parked draft and select the
  // address that was just created.
  useEffect(() => {
    let draft: { form: FormState; editingId: string | null } | null = null;
    try { const raw = sessionStorage.getItem(DRAFT_KEY); if (raw) draft = JSON.parse(raw); } catch { /* ignore */ }
    let newAddrId = '';
    try { newAddrId = sessionStorage.getItem(NEW_ADDRESS_KEY) || ''; } catch { /* ignore */ }
    if (draft) {
      setForm({ ...draft.form, senderAddressId: newAddrId || draft.form.senderAddressId });
      setEditingId(draft.editingId);
      setShowForm(true);
    }
    try { sessionStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(NEW_ADDRESS_KEY); } catch { /* ignore */ }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [{ products }, { addresses }] = await Promise.all([
        api.listProducts(customerId), api.listSenderAddresses(customerId),
      ]);
      setProducts(products); setAddresses(addresses);
    } catch (e: any) {
      notify('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    setEditingId(null);
    setForm({
      ...EMPTY,
      senderAddressId: addresses.length === 1 ? addresses[0].addressId : '',
    });
    setShowForm(true);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.productId);
    setForm({
      name: p.name, nickname: p.nickname || '', senderAddressId: p.senderAddressId || '',
      content: p.content || 'OTHERS', description: p.description, declaredValue: String(p.declaredValue),
      weightG: String(p.weightG), lengthCm: String(p.lengthCm), widthCm: String(p.widthCm), heightCm: String(p.heightCm),
      variants: (p.variants || []).join(', '),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY }); };

  // Park the draft and hop to the Addresses page to create a new "From" address.
  const goAddAddress = () => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, editingId })); } catch { /* ignore */ }
    navigate('/addresses?return=1');
  };

  const onSenderChange = (v: string) => {
    if (v === ADD_NEW) { goAddAddress(); return; }
    setForm((f) => ({ ...f, senderAddressId: v }));
  };

  const save = async () => {
    if (!form.name || !form.weightG) { notify('Product name and weight are required.', 'error'); return; }
    if (!form.nickname.trim()) { notify('Nick name is required.', 'error'); return; }
    if (!form.senderAddressId) { notify('Choose a sender address.', 'error'); return; }
    const nn = form.nickname.trim().toLowerCase();
    if (products.some((p) => p.productId !== editingId && (p.nickname || '').trim().toLowerCase() === nn)) {
      notify('That nick name is already used by another product.', 'error'); return;
    }
    setSaving(true);
    const payload = {
      name: form.name, nickname: form.nickname.trim(), senderAddressId: form.senderAddressId,
      content: form.content || 'OTHERS', description: form.description || form.name,
      declaredValue: Number(form.declaredValue) || 0,
      weightG: Number(form.weightG), lengthCm: Number(form.lengthCm) || 0,
      widthCm: Number(form.widthCm) || 0, heightCm: Number(form.heightCm) || 0,
      variants: parseVariants(form.variants),
    };
    try {
      if (editingId) await api.updateProduct(editingId, payload, customerId);
      else await api.addProduct(payload, customerId);
      closeForm();
      load();
    } catch (e: any) {
      notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!(await confirm({ title: 'Delete product', message: <>Delete <strong>{p.name}</strong>? This cannot be undone.</>, requireCode: true }))) return;
    try {
      await api.deleteProduct(p.productId, customerId);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IN_USE') notify('Cannot delete: this product is used by existing orders.', 'error');
      else notify('Delete failed: ' + (e as Error).message, 'error');
    }
  };

  const verify = async (p: Product) => {
    try {
      await api.verifyProduct(p.productId, true, customerId);
      notify(`Verified "${p.name}".`, 'success');
      load();
    } catch (e: any) {
      notify('Verify failed: ' + e.message, 'error');
    }
  };

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (!customerId) {
    return <div className="fade-in"><h1 className="page-title">Products</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to manage products.</p></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
          <Package size={28} style={{ color: 'var(--primary-color)' }} /> Products
        </h1>
        {canManage && (
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : openNew())}>
            {showForm ? <X size={18} /> : <Plus size={18} />} {showForm ? 'Close' : 'Add Product'}
          </button>
        )}
      </div>

      {!canVerify && canManage && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
          Products you add (or edit) start as <strong>Pending</strong> and can't be booked until an admin verifies them.
        </p>
      )}

      {showForm && canManage && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>{editingId ? 'Edit Product' : 'Add Product'}</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <F label="Name *" v={form.name} on={set('name')} ph="e.g. FY CART" />
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Sender Address *</label>
              <select className="input-field" value={form.senderAddressId} onChange={(e) => onSenderChange(e.target.value)}>
                <option value="">— choose —</option>
                {addresses.map((a) => <option key={a.addressId} value={a.addressId}>{a.label || a.senderName}</option>)}
                <option value={ADD_NEW}>+ Add new address…</option>
              </select>
            </div>
            <F label="Content" v={form.content} on={set('content')} ph="OTHERS / PERFUMES / CLOTHING" />
            <F label="Description" v={form.description} on={set('description')} ph="DTDC item text e.g. MOBILE CASE" />
            <F label="Declared Value (₹)" type="number" v={form.declaredValue} on={set('declaredValue')} />
            <F label="Weight (g) *" type="number" v={form.weightG} on={set('weightG')} />
            <F label="Length (cm)" type="number" v={form.lengthCm} on={set('lengthCm')} />
            <F label="Width (cm)" type="number" v={form.widthCm} on={set('widthCm')} />
            <F label="Height (cm)" type="number" v={form.heightCm} on={set('heightCm')} />
          </div>

          <div className="input-group" style={{ margin: '0.75rem 0 0' }}>
            <label className="input-label">Nick Name *</label>
            <input className="input-field" value={form.nickname} onChange={(e) => set('nickname')(e.target.value)}
              placeholder="e.g. Perfumaina - Nihal" />
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Internal owner tag — shown in reports &amp; pickers, never printed on the label. Must be unique.
            </p>
          </div>

          <div className="input-group" style={{ margin: '0.75rem 0 0' }}>
            <label className="input-label">Variants / sub-types (optional)</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
              <input className="input-field" readOnly value={form.variants} placeholder="No variants"
                style={{ flex: 1, background: 'var(--bg-color)', cursor: 'default' }} />
              <button type="button" className="btn btn-outline" onClick={() => setShowVariantEditor(true)} style={{ width: 'auto', whiteSpace: 'nowrap' }}>
                <Tag size={16} /> Edit variants
              </button>
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Same weight &amp; size for all — the chosen label is added to the order and DTDC description.
            </p>
          </div>

          {addresses.length === 0 && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin size={15} /> No sender addresses yet — pick "+ Add new address…" above to create one.
            </p>
          )}

          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: '1.5rem' }}>
            <Save size={18} /> {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' }}>
        {loading ? <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
          : products.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>No products yet.</p>
          : products.map((p) => (
            <div key={p.productId} className="glass-card" style={{ padding: '1.25rem', position: 'relative', borderLeft: p.status === 'pending' ? '4px solid var(--warning-color)' : undefined }}>
              {canManage && (
                <div style={{ position: 'absolute', top: '0.85rem', right: '0.85rem', display: 'flex', gap: '0.75rem' }}>
                  <button title="Edit" onClick={() => startEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', padding: '0.2rem' }}><Pencil size={17} /></button>
                  {canVerify && <button title="Delete" onClick={() => remove(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', padding: '0.2rem' }}><Trash2 size={17} /></button>}
                </div>
              )}
              <h4 style={{ margin: '0 0 0.25rem 0', paddingRight: canManage ? (canVerify ? '4.5rem' : '2.5rem') : 0 }}>{p.name}</h4>
              {p.nickname && (
                <div style={{ fontSize: '0.78rem', color: 'var(--primary-color)', fontWeight: 600, marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Tag size={12} /> {p.nickname}
                </div>
              )}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{p.senderName}</div>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-color)', margin: '0 0 1rem 0' }}>₹{p.declaredValue}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                {p.status === 'pending'
                  ? <span className="badge badge-processing" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={12} /> Pending</span>
                  : <span className="badge badge-completed" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><BadgeCheck size={12} /> Verified</span>}
                <span className="badge badge-gray">{p.weightG}g</span>
                <span className="badge badge-gray">{p.content}</span>
                {(p.lengthCm || p.widthCm || p.heightCm) ? <span className="badge badge-gray">{p.lengthCm}×{p.widthCm}×{p.heightCm}cm</span> : null}
              </div>
              {p.variants && p.variants.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
                  {p.variants.map((v) => <span key={v} className="badge badge-gray" style={{ opacity: 0.85 }}>{v}</span>)}
                </div>
              )}
              {canVerify && p.status === 'pending' && (
                <button className="btn btn-primary" onClick={() => verify(p)} style={{ marginTop: '1rem', width: '100%' }}>
                  <BadgeCheck size={16} /> Verify product
                </button>
              )}
            </div>
          ))}
      </div>

      {showVariantEditor && (
        <VariantEditor
          initial={parseVariants(form.variants)}
          onSave={(list) => set('variants')(list.join(', '))}
          onClose={() => setShowVariantEditor(false)}
        />
      )}
    </div>
  );
};

// Full-screen editor for a product's variant labels. Add via the blank box at
// the bottom (or Enter), edit each row in place, remove with ✕. Save writes the
// cleaned, de-duplicated list back to the product form.
const VariantEditor = ({ initial, onSave, onClose }: { initial: string[]; onSave: (list: string[]) => void; onClose: () => void }) => {
  const [rows, setRows] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');

  const setRow = (i: number, v: string) => setRows((r) => r.map((x, j) => (j === i ? v : x)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));
  const add = () => {
    const parts = parseVariants(draft); // a pasted "Red, Blue" expands into rows
    if (parts.length) setRows((r) => [...r, ...parts]);
    setDraft('');
  };
  const save = () => {
    const seen = new Set<string>();
    const cleaned = rows.map((v) => v.trim()).filter((v) => {
      if (!v) return false;
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    onSave(cleaned);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'var(--bg-color)', overflowY: 'auto' }}>
      <div className="slide-up" style={{ maxWidth: 560, margin: '0 auto', padding: '1.25rem 1.25rem 4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Tag size={22} /> Edit variants</h2>
          <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={26} /></button>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          One variant per row (e.g. Red, Blue, 100ml). Same weight &amp; size for all.
        </p>

        {rows.length === 0 && <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '1rem' }}>No variants yet — add one below.</p>}

        {rows.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input className="input-field" value={v} onChange={(e) => setRow(i, e.target.value)} placeholder="Variant label" style={{ flex: 1 }} />
            <button type="button" title="Remove" onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', padding: '0.35rem' }}><X size={20} /></button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <input className="input-field" value={draft} placeholder="Add a variant…" style={{ flex: 1 }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="btn btn-outline" onClick={add} disabled={!draft.trim()} style={{ width: 'auto' }}><Plus size={16} /> Add</button>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem' }}>
          <button className="btn btn-outline" onClick={onClose} style={{ flex: '0 0 auto' }}>Cancel</button>
          <button className="btn btn-primary" onClick={save} style={{ flex: 1 }}><Save size={18} /> Save variants</button>
        </div>
      </div>
    </div>
  );
};

const F = ({ label, v, on, type = 'text', ph }: { label: string; v: string; on: (v: string) => void; type?: string; ph?: string }) => (
  <div className="input-group" style={{ margin: 0 }}>
    <label className="input-label">{label}</label>
    <input className="input-field" type={type} value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
  </div>
);
