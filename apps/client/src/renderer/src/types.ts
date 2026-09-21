export interface User {
  id: number
  username: string
  name: string
  role: 'tech' | 'owner' | 'boss' | 'manager' | 'floor' | 'technician' | 'support' | 'employee'
  technician_id?: number | null
}

export type DataSourceMode = 'local' | 'remote'

export interface Store {
  role?: string
  status?: number
  technician_id?: number | null
  id: number
  code: string
  name: string
  short_name?: string | null
  point_clock_business_type?: 'BATH' | 'FOOT' | null
  timezone: string
  currency: string
  role_code: string
  is_default: number
}

export interface SessionBootstrap {
  protocol_version?: number
  realm?: 'merchant' | 'support'
  merchant?: any
  user: User
  stores: Store[]
  current_store_id: number
  csrf: { name: string; hash: string }
  token: string
}

export interface Room {
  id: number
  room_no: string
  room_name: string
  room_type: string
  capacity: number
  status: string
  sort_order: number
  order_id?: number | null
  order_no?: string | null
  customer_name?: string | null
  technician_name?: string | null
  technician_code?: string | null
  wristband_no?: string | null
  opened_at?: string | null
  subtotal?: number | null
  services?: import('./utils/room-operations').RoomService[]
  overtime_minutes?: number
}

export interface Technician {
  id: number
  name: string
  code: string
  phone?: string
  level: string
  status: string
  base_salary: number
  commission_rate: number
  wheel_rate?: number
  dianzhong_rate?: number
  half_rate?: number
  add_time_rate?: number
  dianzhong_bonus?: number
  queue_position?: number
  served_today?: number
  current_room?: string | null
  serving_count?: number
  serving_item?: string | null
  reserved_today?: number
}

export interface Category {
  id: number
  name: string
  type: string
  sort_order: number
}

export interface Item {
  active?:number
  id: number
  name: string
  category_id: number | null
  category_name?: string
  type: string
  price: number
  duration: number
  commission: number
  stock: number
  low_stock_threshold?: number
  cost: number
  unit: string
  sold_out?: number
  is_primary?: number
}

export interface Member {
  id: number
  asset_version?: number
  name: string
  phone?: string
  card_no?: string
  card_type: string
  balance: number
  bonus_balance: number
  times_balance: number
  points: number
  discount: number
  status: string
  salesman?: string
  tags?: string
  level?: string
  birthday?: string
  expiry?: string
  created_at?: string
}

export interface OrderItem {
  id: number
  order_id: number
  item_id: number | null
  item_name: string
  item_type: string
  quantity: number
  price: number
  amount: number
  technician_id: number | null
  technician_name?: string
  technician_code?: string
  service_type?: string
  clock_in_at?: string | null
  clock_paused_at?: string | null
  clock_out_at?: string | null
  duration: number
  add_time_count?: number
  add_time_amount?: number
  status: string
  is_gift: number
  is_refund: number
}

export interface Payment {
  id: number
  order_id: number
  method: string
  amount: number
  paid_at?: string
  voucher_code?: string | null
  source?: string
  reference_no?: string | null
}

export interface Order {
  id: number
  version?: number
  order_no: string
  room_id: number | null
  wristband_no: string | null
  customer_name?: string
  customer_phone?: string
  member_id: number | null
  technician_id: number | null
  status: string
  source: string
  opened_at: string
  closed_at?: string
  subtotal: number
  discount: number
  payable: number
  paid: number
  discount_detail?: string
  deposit?: number
  deposit_refunded?: number
  reservation_id?: number | null
  booking_deposit?: number
  items?: OrderItem[]
  payments?: Payment[]
  room?: Room | null
  member?: Member | null
  room_no?: string
  room_name?: string
  technician_name?: string
  member_name?: string
  cashier_name?: string
}

export interface Wristband {
  id: number
  code: string
  status: string
  active: number
  deposit?: number
  room_id?: number | null
  room_name?: string | null
  card_uid?: string | null
}

export interface Reservation {
  id: number
  version:number
  order_id?:number|null
  duration?:number
  customer_name?: string
  customer_phone?: string
  room_id: number | null
  technician_id: number | null
  reserve_time?: string
  people: number
  status: string
  remark?: string
  room_no?: string
  room_name?: string
  technician_name?: string
  staff_id?: number | null
}

export interface Shift {
  actual_cash?: number | null
  cash_difference?: number | null
  id: number
  cashier_id: number
  start_at: string
  end_at?: string
  start_cash: number
  total_sales: number
  total_cash: number
  total_wechat: number
  total_alipay: number
  total_card: number
  total_meituan: number
  total_douyin: number
  total_member: number
  total_recharge: number
  total_refund: number
  total_discount: number
  deposit_net: number
  booking_deposit_net: number
  expected_cash: number
  net_external: Record<string, number>
  handover_note?: string
  status: string
  cashier_name?: string
}
