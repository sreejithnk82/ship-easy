import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, Save, Plus, X, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { api, SenderAddress, ApiError } from '../lib/api';
import { useProfile } from '../lib/profile';
import { useActiveCustomer } from '../lib/activeCustomer';
import { stateFromPincode } from '../lib/pincode';
import { useToast, useConfirm } from '../components/feedback';

// Set by the Product form before it sends you here ("+ Add new address…").
// On save we drop the new id back so the product form can auto-select it.
export const NEW_ADDRESS_KEY = 'shipeasy.newAddressId';

const EMPTY = {
  label: '', senderName: '', senderPhone: '', senderPincode: '',
  senderCity: '', senderState: '', senderAddr1: '', senderAddr2: '', senderEmail: '',
};
type FormState = typeof EMPTY;

export const Addresses = () => {
  const profile = useProfile();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnToProduct = params.get('return') === '1';

  const { activeId } = useActiveCustomer();
  const customerId = profile?.customerId || activeId;
  const admin = profile?.role === 'superadmin'; // only superadmins manage addresses
  const notify = useToast();
  const confirm = useConfirm();

  const [addresses, setAddresses] = useState<SenderAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(returnToProduct); // jump straight to the form when adding for a product
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (customerId) load(); else { setAddresses([]); setLoading(false); } }, [customerId]);

  const load = async () => {
    setLoading(true);
    try {
      setAddresses((await api.listSenderAddresses(customerId)).addresses);
    } catch (e: any) {
      notify('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => { setEditingId(null); setForm({ ...EMPTY }); setShowForm(true); };
  const startEdit = (a: SenderAddress) => {
    setEditingId(a.addressId);
    setForm({
      label: a.label, senderName: a.senderName, senderPhone: a.senderPhone, senderPincode: a.senderPincode,
      senderCity: a.senderCity, senderState: a.senderState, senderAddr1: a.senderAddr1, senderAddr2: a.senderAddr2, senderEmail: a.senderEmail,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY }); };

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const onPincode = (v: string) => setForm((f) => ({ ...f, senderPincode: v, senderState: stateFromPincode(v) || f.senderState }));

  const save = async () => {
    if (!form.senderName.trim()) { notify('Sender name is required.', 'error'); return; }
    setSaving(true);
    const payload = { ...form, senderName: form.senderName.trim() };
    try {
      if (editingId) {
        await api.updateSenderAddress(editingId, payload, customerId);
        closeForm();
        load();
      } else {
        const { addressId } = await api.addSenderAddress(payload, customerId);
        if (returnToProduct) {
          // Hand the new address back to the product form and return there.
          try { sessionStorage.setItem(NEW_ADDRESS_KEY, addressId); } catch { /* ignore */ }
          navigate('/products');
          return;
        }
        closeForm();
        load();
      }
    } catch (e: any) {
      notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: SenderAddress) => {
    if (!(await confirm({ title: 'Delete address', message: <>Delete address <strong>{a.label || a.senderName}</strong>? This cannot be undone.</>, requireCode: true }))) return;
    try {
      await api.deleteSenderAddress(a.addressId, customerId);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IN_USE') notify('Cannot delete: this address is used by existing products.', 'error');
      else notify('Delete failed: ' + (e as Error).message, 'error');
    }
  };

  if (!customerId) {
    return <div className="fade-in"><h1 className="page-title">Sender Addresses</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Select a customer in the "Acting as" bar above to manage addresses.</p></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
          <MapPin size={28} style={{ color: 'var(--primary-color)' }} /> Sender Addresses
        </h1>
        {returnToProduct ? (
          <button className="btn btn-outline" onClick={() => navigate('/products')} style={{ width: 'auto' }}>
            <ArrowLeft size={18} /> Back to product
          </button>
        ) : admin && (
          <button className="btn btn-primary" onClick={() => (showForm ? closeForm() : openNew())} style={{ width: 'auto' }}>
            {showForm ? <X size={18} /> : <Plus size={18} />} {showForm ? 'Close' : 'Add Address'}
          </button>
        )}
      </div>

      {returnToProduct && !editingId && (
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>Add a new "From" address — you'll return to the product, with it selected.</p>
      )}

      {showForm && admin && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>{editingId ? 'Edit Address' : 'Add Address'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <F label="Label" v={form.label} on={set('label')} ph="e.g. Mumbai Warehouse" />
            <F label="Sender Name *" v={form.senderName} on={set('senderName')} />
            <F label="Sender Phone" v={form.senderPhone} on={set('senderPhone')} />
            <F label="Pincode" v={form.senderPincode} on={onPincode} />
            <F label="City" v={form.senderCity} on={set('senderCity')} />
            <F label="State" v={form.senderState} on={set('senderState')} />
            <F label="Address 1" v={form.senderAddr1} on={set('senderAddr1')} />
            <F label="Address 2" v={form.senderAddr2} on={set('senderAddr2')} />
            <F label="Email" v={form.senderEmail} on={set('senderEmail')} />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: '1.5rem' }}>
            <Save size={18} /> {saving ? 'Saving…' : editingId ? 'Update' : returnToProduct ? 'Save & use' : 'Save'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' }}>
        {loading ? <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
          : addresses.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>No addresses yet.</p>
          : addresses.map((a) => (
            <div key={a.addressId} className="glass-card" style={{ padding: '1.25rem', position: 'relative' }}>
              {admin && (
                <div style={{ position: 'absolute', top: '0.85rem', right: '0.85rem', display: 'flex', gap: '0.75rem' }}>
                  <button title="Edit" onClick={() => startEdit(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', padding: '0.2rem' }}><Pencil size={17} /></button>
                  <button title="Delete" onClick={() => remove(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', padding: '0.2rem' }}><Trash2 size={17} /></button>
                </div>
              )}
              <h4 style={{ margin: '0 0 0.25rem 0', paddingRight: admin ? '4.5rem' : 0 }}>{a.label || a.senderName}</h4>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{a.senderName}{a.senderPhone ? ` · ${a.senderPhone}` : ''}</div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>{[a.senderAddr1, a.senderAddr2].filter(Boolean).join(', ')}</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{[a.senderCity, a.senderState, a.senderPincode].filter(Boolean).join(' · ')}</p>
            </div>
          ))}
      </div>
    </div>
  );
};

const F = ({ label, v, on, ph }: { label: string; v: string; on: (v: string) => void; ph?: string }) => (
  <div className="input-group" style={{ margin: 0 }}>
    <label className="input-label">{label}</label>
    <input className="input-field" value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
  </div>
);
