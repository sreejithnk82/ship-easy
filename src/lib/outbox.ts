// Offline-first booking queue (the "stack") backed by IndexedDB.
//
// Each booked order is saved locally first, so the customer can keep booking
// with no internet. On "Generate Labels" the whole stack is sent in one call;
// only after the server confirms do we clear it. Local storage is an OUTBOX,
// never the system of record.

import { openDB } from 'idb';
import type { OrderInput, Product } from './api';
import type { LabelOrder } from './labels';

export interface PendingOrder extends OrderInput {
  customerId: string;
  createdAt: number;
}

// A completed, locked batch — kept so the user can view it later and
// re-download (regenerate) the same labels. Tracking IDs are already issued,
// so this is a permanent record: never edited, never re-allocated.
export interface SavedBatch {
  batchId: string;
  customerId: string;
  createdAt: number;
  count: number;
  labels: LabelOrder[];
  products: Product[]; // snapshot at generation time, so re-printing always works
}

const DB_NAME = 'shipeasy';
const STORE = 'pending';
const BATCHES = 'batches';
const VERSION = 2;

let dbp: Promise<any> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'clientOrderId' });
          store.createIndex('byCustomer', 'customerId');
        }
        if (!database.objectStoreNames.contains(BATCHES)) {
          const b = database.createObjectStore(BATCHES, { keyPath: 'batchId' });
          b.createIndex('byCustomer', 'customerId');
        }
      },
    });
  }
  return dbp;
}

export function newClientOrderId(): string {
  // crypto.randomUUID is available in all modern browsers; fall back just in case.
  return (globalThis.crypto?.randomUUID?.() ?? `o_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

export async function addPending(order: PendingOrder): Promise<void> {
  await (await db()).put(STORE, order);
}

export async function listPending(customerId: string): Promise<PendingOrder[]> {
  const all = (await (await db()).getAllFromIndex(STORE, 'byCustomer', customerId)) as PendingOrder[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deletePending(clientOrderId: string): Promise<void> {
  await (await db()).delete(STORE, clientOrderId);
}

export async function clearPending(clientOrderIds: string[]): Promise<void> {
  const conn = await db();
  const tx = conn.transaction(STORE, 'readwrite');
  await Promise.all(clientOrderIds.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function countPending(customerId: string): Promise<number> {
  return (await listPending(customerId)).length;
}

// --- Saved batches (label history) ---

export async function saveBatch(batch: SavedBatch): Promise<void> {
  await (await db()).put(BATCHES, batch);
}

export async function listBatches(customerId: string): Promise<SavedBatch[]> {
  const all = (await (await db()).getAllFromIndex(BATCHES, 'byCustomer', customerId)) as SavedBatch[];
  return all.sort((a, b) => b.createdAt - a.createdAt); // newest first
}
