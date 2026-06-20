import { useState, useEffect } from 'react';
import { Package, Save, Plus, X, Pencil, Trash2 } from 'lucide-react';
import { api, Product, HubCode } from '../lib/api';
import { ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';

const EMPTY = {
  productCode: '', name: '', hubCustomerCode: '',
  senderName: '', senderPhone: '', senderAddr1: '', senderAddr2: '',
  senderCity: '', senderState: '', senderPincode: '', senderEmail: '',
  content: 'OTHERS', description: '', declaredValue: '',
  weightG: '', lengthCm: '', widthCm: '', heightCm: '',
};
type FormState = typeof EMPTY;

export const Products = () => {
  const profile = useProfile();
  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;
  const admin = profile?.role === 'superadmin'; // only superadmins manage products
  const [products, setProducts] = useState<Product[]>([]);
  const [hubCodes, setHubCodes] = useState<HubCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (customerId) load(); else { setProducts([]); setLoading(false); } }, [customerId]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ products }, { hubCodes }] = await Promise.all([api.listProducts(customerId), api.listHubCodes()]);
      setProducts(products); setHubCodes(hubCodes);
    } catch (e: any) {
      alert('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // New product: pre-fill the sender block from the customer's defaults.
  const openNew = () => {
    const c = profile?.customer;
    setEditingId(null);
    setForm({
      ...EMPTY,
      senderName: c?.senderName || '', senderPhone: '', senderCity: c?.senderCity || '',
      senderState: c?.senderState || '', senderPincode: c?.senderPincode || '',
      hubCustomerCode: c?.hubCustomerCode || '',
    });
    setShowForm(true);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.productId);
    setForm({
      productCode: p.productCode, name: p.name, hubCustomerCode: p.hubCustomerCode,
      senderName: p.senderName, senderPhone: p.senderPhone, senderAddr1: p.senderAddr1, senderAddr2: p.senderAddr2,
      senderCity: p.senderCity, senderState: p.senderState, senderPincode: p.senderPincode, senderEmail: p.senderEmail,
      content: p.content || 'OTHERS', description: p.description, declaredValue: String(p.declaredValue),
      weightG: String(p.weightG), lengthCm: String(p.lengthCm), widthCm: String(p.widthCm), heightCm: String(p.heightCm),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY }); };

  const save = async () => {
    if (!form.name || !form.weightG) { alert('Product name and weight are required.'); return; }
    if (!form.senderName) { alert('Sender name is required.'); return; }
    setSaving(true);
    const payload = {
      productCode: form.productCode, name: form.name, hubCustomerCode: form.hubCustomerCode,
      senderName: form.senderName, senderPhone: form.senderPhone, senderAddr1: form.senderAddr1, senderAddr2: form.senderAddr2,
      senderCity: form.senderCity, senderState: form.senderState, senderPincode: form.senderPincode, senderEmail: form.senderEmail,
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
      alert('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    try {
      await api.deleteProduct(p.productId, customerId);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IN_USE') alert('Cannot delete: this product is used by existing orders.');
      else alert('Delete failed: ' + (e as Error).message);
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

          <h4 style={{ margin: '0 0 0.5rem', color: 'var(--text-secondary)' }}>Product</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <F label="Name *" v={form.name} on={set('name')} ph="e.g. FY CART" />
            <F label="Product Code" v={form.productCode} on={set('productCode')} ph="OF2357C004P002" />
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Hub Customer Code</label>
              <select className="input-field" value={form.hubCustomerCode} onChange={(e) => set('hubCustomerCode')(e.target.value)}>
                <option value="">— choose —</option>
                {hubCodes.map((h) => <option key={h.code} value={h.code}>{h.code}{h.label ? ` (${h.label})` : ''}</option>)}
              </select>
            </div>
            <F label="Content" v={form.content} on={set('content')} ph="OTHERS / PERFUMES / CLOTHING" />
            <F label="Description *" v={form.description} on={set('description')} ph="DTDC item text e.g. MOBILE CASE" />
            <F label="Declared Value (₹)" type="number" v={form.declaredValue} on={set('declaredValue')} />
            <F label="Weight (g) *" type="number" v={form.weightG} on={set('weightG')} />
            <F label="Length (cm)" type="number" v={form.lengthCm} on={set('lengthCm')} />
            <F label="Width (cm)" type="number" v={form.widthCm} on={set('widthCm')} />
            <F label="Height (cm)" type="number" v={form.heightCm} on={set('heightCm')} />
          </div>

          <h4 style={{ margin: '1.25rem 0 0.5rem', color: 'var(--text-secondary)' }}>Sender (appears as the "From" on this product's shipments)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <F label="Sender Name *" v={form.senderName} on={set('senderName')} />
            <F label="Sender Phone" v={form.senderPhone} on={set('senderPhone')} />
            <F label="Pincode" v={form.senderPincode} on={set('senderPincode')} />
            <F label="City" v={form.senderCity} on={set('senderCity')} />
            <F label="State" v={form.senderState} on={set('senderState')} />
            <F label="Address 1" v={form.senderAddr1} on={set('senderAddr1')} />
            <F label="Address 2" v={form.senderAddr2} on={set('senderAddr2')} />
            <F label="Email" v={form.senderEmail} on={set('senderEmail')} />
          </div>

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
