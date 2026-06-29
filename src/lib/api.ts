// Thin client for the Apps Script web app.
//
// Calls go out as a "simple" POST (Content-Type: text/plain) so the browser
// skips the CORS preflight that Apps Script can't answer; the body is still
// JSON. Every call carries the current Google ID token, and the server derives
// identity/role from it.

import { WEBAPP_URL } from './config';
import { ensureIdToken } from './auth';

export class ApiError extends Error {
  code: string;
  detail?: string;
  available?: number;
  constructor(code: string, detail?: string, extra?: Record<string, any>) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
    if (extra) Object.assign(this, extra);
  }
}

export async function callApi<T = any>(action: string, payload: Record<string, any> = {}): Promise<T> {
  if (!WEBAPP_URL) throw new ApiError('NO_ENDPOINT', 'VITE_WEBAPP_URL is not set.');

  const token = await ensureIdToken();
  let res: Response;
  try {
    res = await fetch(WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow',
    });
  } catch (e: any) {
    throw new ApiError('NETWORK', e?.message || 'Network request failed');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `HTTP ${res.status}: non-JSON response`);
  }

  if (!data || data.ok !== true) {
    const { error, detail, ...rest } = data || {};
    throw new ApiError(error || 'ERROR', detail, rest);
  }
  return data as T;
}

/* Typed wrappers for the actions the UI uses. */

export interface Sender {
  customerId: string; name: string;
  senderPincode: string; senderName: string; senderPhone: string;
  senderAddr1: string; senderAddr2: string; senderCity: string;
  senderState: string; senderEmail: string; hubCustomerCode: string;
}
export interface Profile { email: string; role: string; customerId: string; customer?: Sender; maintenance?: string; }
// A reusable "From" address. Products reference one by id; the server resolves
// the sender block live, so editing an address updates every product using it.
export interface SenderAddress {
  addressId: string;
  label: string;
  senderName: string; senderPhone: string;
  senderAddr1: string; senderAddr2: string;
  senderCity: string; senderState: string;
  senderPincode: string; senderEmail: string;
}
export interface Product {
  productId: string;
  productCode: string;
  name: string;
  hubCustomerCode: string;
  senderAddressId: string;
  senderName: string; senderPhone: string; senderAddr1: string; senderAddr2: string;
  senderCity: string; senderState: string; senderPincode: string; senderEmail: string;
  content: string;
  description: string;
  declaredValue: number;
  weightG: number; lengthCm: number; widthCm: number; heightCm: number;
  status?: string;        // 'verified' | 'pending' — only verified can be booked
  createdBy?: string; verifiedBy?: string; verifiedAt?: string;
}
export interface OrderInput {
  clientOrderId: string; productId: string;
  extraProductIds?: string[]; // up to 4 more products in the SAME parcel (one label)
  receiverName: string; receiverPhone: string; receiverPincode: string;
  receiverLine1: string; receiverLine2: string; receiverState: string;
}
export interface OpenOrder extends Omit<OrderInput, 'clientOrderId'> { orderId: string; trackingId: string; exportedAt?: string; }
export interface Assignment { clientOrderId: string; trackingId: string; }

// A customer's own order with live lifecycle status (server-backed history).
export interface OrderRow {
  orderId: string; batchId: string; trackingId: string; productId: string;
  receiverName: string; receiverPhone: string; receiverPincode: string;
  receiverLine1: string; receiverLine2: string; receiverState: string;
  status: 'labeled' | 'shipped' | 'void' | string;
  exportedAt: string; shippedAt: string; voidedAt: string; createdAt: string;
}
export interface Balance { customerId: string; name: string; remaining: number; low: boolean; }
export interface Health { orderRows: number; columns: number; orderCells: number; cellLimit: number; warn: boolean; pctOfLimit: number; }

export interface Customer {
  customerId: string; name: string; spreadsheetId?: string;
  senderPincode: string; senderName: string; senderPhone: string;
  senderAddr1: string; senderAddr2: string; senderCity: string;
  senderState: string; senderEmail: string; hubCustomerCode: string; status: string;
}
export interface UserRow { email: string; customerId: string; role: string; status: string; }
export interface HubCode { code: string; label: string; }
export interface TrackingRange {
  seq: number; prefix: string; start: number; end: number;
  pad: number; cursor: number; status: string; remaining: number;
  allocated: number; used: boolean;
}

export const api = {
  getProfile: () => callApi<Profile & { ok: true }>('getProfile'),
  listProducts: (customerId?: string) => callApi<{ products: Product[] }>('listProducts', { customerId }),
  addProduct: (product: Partial<Product>, customerId?: string) =>
    callApi<{ productId: string }>('addProduct', { product, customerId }),
  updateProduct: (productId: string, product: Partial<Product>, customerId?: string) =>
    callApi<{ changed: number }>('updateProduct', { productId, product, customerId }),
  deleteProduct: (productId: string, customerId?: string) =>
    callApi<{ ok: true }>('deleteProduct', { productId, customerId }),
  verifyProduct: (productId: string, verified: boolean, customerId?: string) =>
    callApi<{ status: string }>('verifyProduct', { productId, verified, customerId }),
  listSenderAddresses: (customerId?: string) =>
    callApi<{ addresses: SenderAddress[] }>('listSenderAddresses', { customerId }),
  addSenderAddress: (address: Partial<SenderAddress>, customerId?: string) =>
    callApi<{ addressId: string }>('addSenderAddress', { address, customerId }),
  updateSenderAddress: (addressId: string, address: Partial<SenderAddress>, customerId?: string) =>
    callApi<{ changed: number }>('updateSenderAddress', { addressId, address, customerId }),
  deleteSenderAddress: (addressId: string, customerId?: string) =>
    callApi<{ ok: true }>('deleteSenderAddress', { addressId, customerId }),
  generateLabels: (customerId: string, idempotencyKey: string, orders: OrderInput[]) =>
    callApi<{ batchId: string; count: number; assignments: Assignment[] }>(
      'generateLabels', { customerId, idempotencyKey, orders }),
  listOpenOrders: (customerId: string) => callApi<{ orders: OpenOrder[] }>('listOpenOrders', { customerId }),
  updateOrder: (
    customerId: string,
    key: { orderId?: string; trackingId?: string },
    fields: Partial<Omit<OpenOrder, 'orderId' | 'trackingId'>>,
  ) => callApi<{ changed: number }>('updateOrder', { customerId, ...key, fields }),
  commitShipment: (customerId: string, trackingIds: string[], manifestId?: string) =>
    callApi<{ manifestId: string; marked: string[]; alreadyShipped: string[]; notFound: string[] }>(
      'commitShipment', { customerId, trackingIds, manifestId }),
  voidOrder: (customerId: string, trackingId: string) =>
    callApi<{ trackingId: string; alreadyVoid?: boolean }>('voidOrder', { customerId, trackingId }),
  recordExport: (customerId: string, trackingIds: string[], exportId?: string) =>
    callApi<{ exportId: string; marked: string[]; alreadyExported: { trackingId: string; exportedAt: string }[]; shipped: string[]; notFound: string[] }>(
      'recordExport', { customerId, trackingIds, exportId }),
  listOrders: (customerId: string, limit?: number) =>
    callApi<{ orders: OrderRow[] }>('listOrders', { customerId, limit }),
  customerBalance: (customerId: string) =>
    callApi<{ remaining: number; threshold: number; low: boolean }>('customerBalance', { customerId }),
  listBalances: () => callApi<{ balances: Balance[]; threshold: number }>('listBalances'),
  customerHealth: (customerId: string) => callApi<Health & { ok: true }>('customerHealth', { customerId }),
  archiveOrders: (customerId: string, beforeISO: string) =>
    callApi<{ moved: number }>('archiveOrders', { customerId, beforeISO }),

  // superadmin onboarding
  listCustomers: () => callApi<{ customers: Customer[] }>('listCustomers'),
  createCustomer: (customer: Partial<Customer> & { customerId: string; name: string }) =>
    callApi<{ customerId: string; spreadsheetUrl: string }>('createCustomer', { customer }),
  updateCustomer: (customerId: string, fields: Partial<Customer>) =>
    callApi<{ ok: true }>('updateCustomer', { customerId, fields }),
  listServiceablePincodes: () => callApi<{ pincodes: string[] }>('listServiceablePincodes'),
  listHubCodes: () => callApi<{ hubCodes: HubCode[] }>('listHubCodes'),
  addHubCode: (code: string, label?: string) => callApi<{ ok: true }>('addHubCode', { code, label }),
  addUser: (user: { email: string; customerId: string; role: string }) =>
    callApi<{ ok: true }>('addUser', { user }),
  listUsers: () => callApi<{ users: UserRow[] }>('listUsers'),
  addTrackingRange: (customerId: string, range: { prefix?: string; start: number; end: number; pad?: number }) =>
    callApi<{ seq: number }>('addTrackingRange', { customerId, range }),
  listTrackingRanges: (customerId: string) => callApi<{ ranges: TrackingRange[] }>('listTrackingRanges', { customerId }),
  updateTrackingRange: (customerId: string, seq: number, range: { prefix?: string; start?: number; end?: number; pad?: number; status?: string }) =>
    callApi<{ ok: true }>('updateTrackingRange', { customerId, seq, range }),
  deleteTrackingRange: (customerId: string, seq: number) =>
    callApi<{ ok: true }>('deleteTrackingRange', { customerId, seq }),
  reassignTrackingRange: (fromCustomerId: string, toCustomerId: string, seq: number) =>
    callApi<{ newSeq: number }>('reassignTrackingRange', { fromCustomerId, toCustomerId, seq }),
};
