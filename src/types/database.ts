export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'accountant' | 'user';
export type AccountType = 
  | 'activo' 
  | 'pasivo' 
  | 'patrimonio' 
  | 'ingreso' 
  | 'gasto'
  | 'costo'
  | 'cuenta_orden';
export type EntryType = 'debit' | 'credit';
export type JournalEntryStatus = 'draft' | 'posted' | 'voided';
export type AccountNature = 'deudora' | 'acreedora';
export type PeriodType = 'monthly' | 'quarterly' | 'annual' | 'custom';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface AccountCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface Account {
  id: string;
  category_id: string | null;
  parent_id: string | null;
  code: string;
  name: string;
  description: string | null;
  type: AccountType;
  nature: AccountNature;
  is_active: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
  category?: Pick<AccountCategory, 'name'>;
  parent?: Pick<Account, 'code' | 'name'>;
}

export interface AccountingPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  period_type: PeriodType;
  fiscal_purpose: string | null;
  is_closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  entry_number: number;
  date: string;
  description: string;
  period_id: string;
  is_posted: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  total_debit: number | null;
  total_credit: number | null;
  status: JournalEntryStatus;
  notes: string | null;
}

export interface JournalEntryItem {
  id: string;
  entry_id: string;
  account_id: string;
  type: EntryType;
  amount: number;
  description: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  account?: Pick<Account, 'code' | 'name'>;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Json | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_data: Json | null;
  new_data: Json | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface UserSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_type: string | null;
  created_at: string;
}