import { createContext, useContext } from 'react';

// For superadmins (who belong to no single customer), the operator pages
// (Products, Book, Scan) act on a chosen "active" customer. Members/admins
// ignore this — they always use their own customer.
export const ActiveCustomerContext = createContext<{ activeId: string; setActiveId: (id: string) => void }>({
  activeId: '',
  setActiveId: () => {},
});

export const useActiveCustomer = () => useContext(ActiveCustomerContext);
export const ACTIVE_CUSTOMER_KEY = 'shipeasy.activeCustomer';
