/** Result of a server action. `href`: where to go after a successful dialog submit. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  at?: number;
  href?: string;
  /** Optional toast text shown on success (overrides the form's default). */
  message?: string;
  tone?: "good" | "warn" | "bad";
} | null;

export type Settings = {
  owner_id: string;
  gym_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  tax_rate: number;
  expiry_alert_days: number;
  freeze_max_days: number | null;
  freeze_fee: number;
};

export type PlanKind = "membership" | "personal_training" | "pass";

export type Plan = {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  admission_fee: number;
  kind: PlanKind;
  sessions: number | null;
  description: string | null;
  is_active: boolean;
};

export type Trainer = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  specialization: string | null;
  salary: number;
  pt_commission_pct: number;
  joined_on: string;
  status: "active" | "inactive";
  notes: string | null;
};

export type Member = {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  gender: "male" | "female" | "other" | null;
  date_of_birth: string | null;
  address: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  medical_notes: string | null;
  trainer_id: string | null;
  joined_on: string;
  status: "active" | "frozen" | "inactive";
  notes: string | null;
  /** Storage path in the private member-photos bucket. */
  photo_path: string | null;
  created_at: string;
};

export type MemberOverview = Member & {
  trainer_name: string | null;
  membership_id: string | null;
  plan_name: string | null;
  membership_start: string | null;
  membership_end: string | null;
  membership_status: string | null;
  membership_kind: PlanKind | null;
  freeze_start: string | null;
  freeze_end: string | null;
  balance_due: number;
  next_due_on: string | null;
  pt_plan_name: string | null;
  pt_end: string | null;
  pt_trainer_name: string | null;
  last_visit: string | null;
};

export type MembershipBalance = {
  id: string;
  member_id: string;
  plan_id: string | null;
  plan_name: string;
  /** "charge" = one-off due: counter sale on credit, freeze or transfer fee. */
  kind: PlanKind | "charge";
  trainer_id: string | null;
  sessions_total: number | null;
  sessions_used: number;
  start_date: string;
  end_date: string;
  price: number;
  discount: number;
  balance_due_on: string | null;
  status: "active" | "cancelled" | "frozen";
  notes: string | null;
  paid: number;
  refunded: number;
  balance: number;
  created_at: string;
};

export type Refund = {
  id: string;
  member_id: string;
  membership_id: string | null;
  amount: number;
  method: string;
  refunded_on: string;
  reason: string | null;
  refund_no: string | null;
  members?: { full_name: string; member_code: string } | null;
};

export type Freeze = {
  id: string;
  membership_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
};

export type Payment = {
  id: string;
  member_id: string;
  membership_id: string | null;
  amount: number;
  method: string;
  category: string;
  paid_on: string;
  receipt_no: string | null;
  share_token: string;
  reference: string | null;
  notes: string | null;
  members?: { full_name: string; member_code: string } | null;
};

export type Attendance = {
  id: string;
  member_id: string;
  check_in: string;
  check_out: string | null;
  members?: { full_name: string; member_code: string; photo_path?: string | null } | null;
};

export type Measurement = {
  id: string;
  member_id: string;
  measured_on: string;
  weight_kg: number | null;
  height_cm: number | null;
  body_fat_pct: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  arms_cm: number | null;
  notes: string | null;
};

export type GymClass = {
  id: string;
  name: string;
  trainer_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  capacity: number;
  room: string | null;
  is_active: boolean;
  trainers?: { full_name: string } | null;
};

export type Expense = {
  id: string;
  category: string;
  amount: number;
  spent_on: string;
  vendor: string | null;
  description: string | null;
  method: string;
  trainer_id: string | null;
  bill_path: string | null;
};

export type RecurringExpense = {
  id: string;
  category: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  method: string;
  day_of_month: number;
  trainer_id: string | null;
  is_active: boolean;
  last_posted: string | null;
};

export type PtSession = {
  id: string;
  membership_id: string;
  trainer_id: string | null;
  session_date: string;
  notes: string | null;
};

export type EquipmentService = {
  id: string;
  equipment_id: string;
  serviced_on: string;
  cost: number;
  next_service: string | null;
  notes: string | null;
};

export type ClassBooking = {
  id: string;
  class_id: string;
  member_id: string;
  class_date: string;
  status: "booked" | "attended" | "cancelled" | "no_show";
  members?: { full_name: string; member_code: string } | null;
};

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  price: number;
  cost: number;
  stock: number;
  low_stock_level: number;
  is_active: boolean;
};

export type Sale = {
  id: string;
  product_id: string | null;
  product_name: string;
  member_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total: number;
  method: string;
  sold_on: string;
  receipt_no: string | null;
  on_credit: boolean;
  share_token: string;
  members?: { full_name: string; phone?: string | null } | null;
};

export type Equipment = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  serial_no: string | null;
  quantity: number;
  purchase_date: string | null;
  purchase_cost: number;
  status: "working" | "needs_service" | "out_of_order" | "retired";
  last_service: string | null;
  next_service: string | null;
  notes: string | null;
};

export type Lead = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  interest: string | null;
  status: "new" | "contacted" | "trial" | "converted" | "lost";
  follow_up_on: string | null;
  notes: string | null;
  converted_member_id: string | null;
  created_at: string;
};
