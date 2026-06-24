import { createContext, useContext } from 'react';
import type { Profile } from './api';

// The signed-in user's profile (role + customer/sender), provided by App.
export const ProfileContext = createContext<Profile | null>(null);
export const useProfile = () => useContext(ProfileContext);
export const isAdmin = (p: Profile | null) => p?.role === 'admin' || p?.role === 'superadmin';
// Warehouse "operator": scan-page only (scan + export xlsx + mark shipped).
export const isOperator = (p: Profile | null) => p?.role === 'operator';
// Who may use the Scan & Book page at all.
export const canScan = (p: Profile | null) => isAdmin(p) || isOperator(p);
