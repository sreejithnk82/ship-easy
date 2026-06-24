import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Save, Plus, X, Pencil, Trash2, MapPin } from 'lucide-react';
import { api, Product, HubCode, SenderAddress } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { NEW_ADDRESS_KEY } from './Addresses';
import { useToast, useConfirm } from '../components/feedback';

const EMPTY = {
  name: '', hubCustomerCode: '', senderAddressId: '',
  content: 'OTHERS', description: '', declaredValue: '',
  weightG: '', lengthCm: '', widthCm: '', heightCm: '',
};
type FormState = typeof EMPTY;

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
  const admin = profile?.role === 'superadmin'; // only superadmins manage products
  const notify = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [hubCodes, setHubCodes] = useState<HubCode[]>([]);
  const [addresses, setAddresses] = useState<SenderAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      const [{ products }, { hubCodes }, { addresses }] = await Promise.all([
        api.listProducts(customerId), api.listHubCodes(), api.listSenderAddresses(customerId),
      ]);
      setProducts(products); setHubCodes(hubCodes); setAddresses(addresses);
    } catch (e: any) {
      notify('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    const c = profile?.customer;
    setEditingId(null);
    setForm({
      ...EMPTY,
      hubCustomerCode: c?.hubCustomerCode || '',
      senderAddressId: addresses.length === 1 ? addresses[0].addressId : '',
    });
    setShowForm(true);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.productId);
    setForm({
      name: p.name, hubCustomerCode: p.hubCustomerCode, senderAddressId: p.senderAddressId || '',
      content: p.content || 'OTHERS', description: p.description, declaredValue: String(p.declaredValue),
      weightG: String(p.weightG), lengthCm: String(p.lengthCm), widthCm: String(p.widthCm), heightCm: String(p.heightCm),
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
    if (!form.senderAddressId) { notify('Choose a sender address.', 'error'); return; }
    setSaving(true);
    const payload = {
      name: form.name, hubCustomerCode: form.hubCustomerCode, senderAddressId: form.senderAddressId,
      content: form.content || 'OTHERS', description: form.description || form.name,
      declaredValue: Number(form.declaredValue) || 0,
      weightG: Number(form.weightG), lengthCm: Number(form.lengthCm) || 0,
      widthCm: Number(form.widthCm) || 0, heightCm: Number(form.heightCm) || 0,
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
        {admin && (
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : openNew())}>
            {showForm ? <X size={18} /> : <Plus size={18} />} {showForm ? 'Close' : 'Add Product'}
          </button>
        )}
      </div>

      {showForm && admin && (
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
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Hub Customer Code</label>
              <select className="input-field" value={form.hubCustomerCode} onChange={(e) => set('hubCustomerCode')(e.target.value)}>
                <option value="">— choose —</option>
                {hubCodes.map((h) => <option key={h.code} value={h.code}>{h.code}{h.label ? ` (${h.label})` : ''}</option>)}
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
            <div key={p.productId} className="glass-card" style={{ padding: '1.25rem', position: 'relative' }}>
              {admin && (
                <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', gap: '0.25rem' }}>
                  <button onClick={() => startEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)' }}><Pencil size={16} /></button>
                  <button onClick={() => remove(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)' }}><Trash2 size={16} /></button>
                </div>
              )}
              <h4 style={{ margin: '0 0 0.25rem 0', paddingRight: admin ? '3.5rem' : 0 }}>{p.name}</h4>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{p.senderName} · {p.hubCustomerCode}</div>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-color)', margin: '0 0 1rem 0' }}>₹{p.declaredValue}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="badge badge-gray">{p.weightG}g</span>
                <span className="badge badge-gray">{p.content}</span>
                {(p.lengthCm || p.widthCm || p.heightCm) ? <span className="badge badge-gray">{p.lengthCm}×{p.widthCm}×{p.heightCm}cm</span> : null}
              </div>
            </div>
          ))}
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
