// Offline-first booking queue (the "stack") backed by IndexedDB.
//
// Each booked order is saved locally first, so the customer can keep booking
// with no internet. On "Generate Labels" the whole stack is sent in one call;
// only after the server confirms do we clear it. Local storage is an OUTBOX,
// never the system of record.

import { openDB } from 'idb';
import type { OrderInput } from './api';

export interface PendingOrder extends OrderInput {
  customerId: string;
  createdAt: number;
}

const DB_NAME = 'shipeasy';
const STORE = 'pending';
const VERSION = 1;

let dbp: Promise<any> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: 'clientOrderId' });
        store.createIndex('byCustomer', 'customerId');
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
