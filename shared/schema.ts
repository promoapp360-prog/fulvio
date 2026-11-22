// Schema Drizzle – rispecchia esattamente migrations/*.sql (fonte di verità per la struttura).
import {
  pgTable, serial, bigserial, integer, smallint, varchar, text, boolean, timestamp, date, jsonb, numeric, primaryKey,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 40 }),
  address: varchar("address", { length: 255 }),
  city: varchar("city", { length: 120 }),
  province: varchar("province", { length: 10 }),
  cap: varchar("cap", { length: 10 }),
  country: varchar("country", { length: 80 }),
  birthDate: date("birth_date"),
  notes: text("notes"),
  commEmail: boolean("comm_email").notNull().default(true),
  commPush: boolean("comm_push").notNull().default(true),
  commWhatsapp: boolean("comm_whatsapp").notNull().default(false),
  consentPrivacy: boolean("consent_privacy").notNull().default(false),
  consentMarketing: boolean("consent_marketing").notNull().default(false),
  consentDate: ts("consent_date"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  resetToken: varchar("reset_token", { length: 128 }),
  resetExpires: ts("reset_expires"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const dogCustomFields = pgTable("dog_custom_fields", {
  id: serial("id").primaryKey(),
  fieldKey: varchar("field_key", { length: 60 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  fieldType: varchar("field_type", { length: 20 }).notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  required: boolean("required").notNull().default(false),
  section: varchar("section", { length: 40 }).notNull().default("altro"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export type DogFood = {
  dry?: boolean; wet?: boolean; flavors?: string; brands?: string; needs?: string; diets?: string; notes?: string;
  [k: string]: unknown;
};

export const dogs = pgTable("dogs", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  name: varchar("name", { length: 80 }).notNull(),
  breed: varchar("breed", { length: 120 }),
  size: varchar("size", { length: 10 }).notNull().default("media"),
  weightKg: numeric("weight_kg", { precision: 5, scale: 2 }),
  birthDate: date("birth_date"),
  notes: text("notes"),
  coatKnots: boolean("coat_knots").notNull().default(false),
  coatShedding: boolean("coat_shedding").notNull().default(false),
  lastBath: date("last_bath"),
  coatType: varchar("coat_type", { length: 80 }),
  coatNotes: text("coat_notes"),
  jointIssues: text("joint_issues"),
  dermatitis: text("dermatitis"),
  intolerances: text("intolerances"),
  sensitivities: text("sensitivities"),
  aggressive: boolean("aggressive").notNull().default(false),
  aggressiveNotes: text("aggressive_notes"),
  otherNeeds: text("other_needs"),
  otherPets: text("other_pets"),
  food: jsonb("food").$type<DogFood>().notNull().default({}),
  customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
  photoUrl: text("photo_url"),
  archived: boolean("archived").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 140 }).notNull(),
  category: varchar("category", { length: 80 }).notNull().default("Toelettatura"),
  description: text("description"),
  priceCents: integer("price_cents"),
  priceFrom: boolean("price_from").notNull().default(true),
  durationMin: integer("duration_min").notNull().default(60),
  bookable: boolean("bookable").notNull().default(true),
  active: boolean("active").notNull().default(true),
  visible: boolean("visible").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const serviceVariants = pgTable("service_variants", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => services.id),
  size: varchar("size", { length: 10 }).notNull(),
  priceCents: integer("price_cents"),
  durationMin: integer("duration_min"),
});

export const serviceSupplements = pgTable("service_supplements", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").references(() => services.id),
  name: varchar("name", { length: 120 }).notNull(),
  condition: varchar("condition", { length: 20 }).notNull().default("manuale"),
  priceCents: integer("price_cents").notNull().default(0),
  extraMin: integer("extra_min").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const operators = pgTable("operators", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: varchar("name", { length: 80 }).notNull(),
  color: varchar("color", { length: 9 }).notNull().default("#2E8DE6"),
  bio: text("bio"),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(1000),
  vatNumber: varchar("vat_number", { length: 20 }),
  bookableOnline: boolean("bookable_online").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const operatorServices = pgTable("operator_services", {
  operatorId: integer("operator_id").notNull().references(() => operators.id),
  serviceId: integer("service_id").notNull().references(() => services.id),
}, (t) => ({ pk: primaryKey({ columns: [t.operatorId, t.serviceId] }) }));

export const operatorShifts = pgTable("operator_shifts", {
  id: serial("id").primaryKey(),
  operatorId: integer("operator_id").notNull().references(() => operators.id),
  weekday: smallint("weekday").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  breakStart: varchar("break_start", { length: 5 }),
  breakEnd: varchar("break_end", { length: 5 }),
});

export const operatorAbsences = pgTable("operator_absences", {
  id: serial("id").primaryKey(),
  operatorId: integer("operator_id").references(() => operators.id),
  kind: varchar("kind", { length: 20 }).notNull().default("ferie"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  startTime: varchar("start_time", { length: 5 }),
  endTime: varchar("end_time", { length: 5 }),
  note: text("note"),
});

export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull().default("postazione"),
  active: boolean("active").notNull().default(true),
});

export const APPOINTMENT_STATUSES = [
  "richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento", "completata", "annullata", "rifiutata", "assente",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
/** Stati che occupano lo slot in agenda (anche le richieste non confermate, per evitare doppie richieste). */
export const BLOCKING_STATUSES: AppointmentStatus[] = ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"];

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => users.id),
  dogId: integer("dog_id").notNull().references(() => dogs.id),
  serviceId: integer("service_id").notNull().references(() => services.id),
  operatorId: integer("operator_id").references(() => operators.id),
  resourceId: integer("resource_id").references(() => resources.id),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  durationMin: integer("duration_min").notNull(),
  status: varchar("status", { length: 20 }).$type<AppointmentStatus>().notNull().default("richiesta"),
  customerNotes: text("customer_notes"),
  adminNotes: text("admin_notes"),
  estimatedPriceCents: integer("estimated_price_cents"),
  finalPriceCents: integer("final_price_cents"),
  paymentMode: varchar("payment_mode", { length: 20 }).notNull().default("nessuno"),
  depositCents: integer("deposit_cents"),
  proposedStartAt: ts("proposed_start_at"),
  proposedOperatorId: integer("proposed_operator_id").references(() => operators.id),
  allowOverlap: boolean("allow_overlap").notNull().default(false),
  changeRequest: text("change_request"),
  source: varchar("source", { length: 20 }).notNull().default("online"),
  reminderSentAt: ts("reminder_sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const appointmentEvents = pgTable("appointment_events", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").notNull().references(() => appointments.id),
  actorId: integer("actor_id").references(() => users.id),
  action: varchar("action", { length: 40 }).notNull(),
  fromStatus: varchar("from_status", { length: 20 }),
  toStatus: varchar("to_status", { length: 20 }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  contact: varchar("contact", { length: 120 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  vatNumber: varchar("vat_number", { length: 20 }),
  address: varchar("address", { length: 255 }),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull(),
  category: varchar("category", { length: 80 }).notNull().default("Accessori"),
  description: text("description"),
  priceCents: integer("price_cents").notNull().default(0),
  salePriceCents: integer("sale_price_cents"),
  costCents: integer("cost_cents"),
  vatRate: numeric("vat_rate", { precision: 4, scale: 2 }).notNull().default("22"),
  sku: varchar("sku", { length: 60 }),
  barcode: varchar("barcode", { length: 60 }),
  stock: integer("stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  imageUrl: text("image_url"),
  isFood: boolean("is_food").notNull().default(false),
  visibleOnline: boolean("visible_online").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  qty: integer("qty").notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  reference: varchar("reference", { length: 120 }),
  note: text("note"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default("in_attesa"),
  totalCents: integer("total_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  promoCode: varchar("promo_code", { length: 40 }),
  delivery: varchar("delivery", { length: 20 }).notNull().default("ritiro"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  productId: integer("product_id").references(() => products.id),
  name: varchar("name", { length: 160 }).notNull(),
  qty: integer("qty").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  orderId: integer("order_id").references(() => orders.id),
  boardingId: integer("boarding_id"),
  customerId: integer("customer_id").references(() => users.id),
  kind: varchar("kind", { length: 20 }).notNull(),
  method: varchar("method", { length: 30 }).notNull(),
  methodLabel: varchar("method_label", { length: 60 }),
  amountCents: integer("amount_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pagato"),
  provider: varchar("provider", { length: 30 }),
  providerRef: varchar("provider_ref", { length: 255 }),
  checkoutUrl: text("checkout_url"),
  paidAt: ts("paid_at"),
  note: text("note"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workLogs = pgTable("work_logs", {
  id: serial("id").primaryKey(),
  operatorId: integer("operator_id").notNull().references(() => operators.id),
  workDate: date("work_date").notNull(),
  clockIn: varchar("clock_in", { length: 5 }).notNull(),
  clockOut: varchar("clock_out", { length: 5 }),
  breakMin: integer("break_min").notNull().default(0),
  effectiveMin: integer("effective_min").notNull().default(0),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  note: text("note"),
  corrected: boolean("corrected").notNull().default(false),
  correctionNote: text("correction_note"),
  correctedBy: integer("corrected_by").references(() => users.id),
  paid: boolean("paid").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const selfserviceIncomes = pgTable("selfservice_incomes", {
  id: serial("id").primaryKey(),
  incomeDate: date("income_date").notNull(),
  station: varchar("station", { length: 60 }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: varchar("method", { length: 30 }).notNull().default("contanti"),
  category: varchar("category", { length: 60 }),
  note: text("note"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loyaltyCards = pgTable("loyalty_cards", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => users.id),
  code: varchar("code", { length: 20 }).notNull(),
  points: integer("points").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => loyaltyCards.id),
  points: integer("points").notNull(),
  reason: varchar("reason", { length: 160 }).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  orderId: integer("order_id").references(() => orders.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loyaltyRewards = pgTable("loyalty_rewards", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  pointsCost: integer("points_cost").notNull(),
  active: boolean("active").notNull().default(true),
});

export const boardingRequests = pgTable("boarding_requests", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => users.id),
  dogId: integer("dog_id").notNull().references(() => dogs.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("richiesta"),
  customerNotes: text("customer_notes"),
  adminNotes: text("admin_notes"),
  priceCents: integer("price_cents"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const pages = pgTable("pages", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  subtitle: varchar("subtitle", { length: 255 }),
  body: text("body").notNull().default(""),
  seoTitle: varchar("seo_title", { length: 160 }),
  seoDescription: varchar("seo_description", { length: 320 }),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  published: boolean("published").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const faqs = pgTable("faqs", {
  id: serial("id").primaryKey(),
  section: varchar("section", { length: 40 }).notNull().default("generale"),
  question: varchar("question", { length: 255 }).notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  storageKey: varchar("storage_key", { length: 255 }).notNull(),
  url: text("url").notNull(),
  mime: varchar("mime", { length: 80 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  alt: varchar("alt", { length: 255 }),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const promotions = pgTable("promotions", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  code: varchar("code", { length: 40 }),
  discountType: varchar("discount_type", { length: 10 }).notNull().default("percent"),
  discountValue: integer("discount_value").notNull().default(0),
  appliesTo: varchar("applies_to", { length: 20 }).notNull().default("tutto"),
  audience: varchar("audience", { length: 20 }).notNull().default("tutti"),
  startsAt: date("starts_at"),
  endsAt: date("ends_at"),
  showOnSite: boolean("show_on_site").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  body: text("body").notNull(),
  channel: varchar("channel", { length: 10 }).notNull().default("email"),
  audience: varchar("audience", { length: 20 }).notNull().default("marketing"),
  promotionId: integer("promotion_id").references(() => promotions.id),
  status: varchar("status", { length: 10 }).notNull().default("bozza"),
  sentCount: integer("sent_count").notNull().default(0),
  sentAt: ts("sent_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const emailLog = pgTable("email_log", {
  id: serial("id").primaryKey(),
  toEmail: varchar("to_email", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  template: varchar("template", { length: 60 }),
  status: varchar("status", { length: 10 }).notNull(),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body"),
  url: varchar("url", { length: 255 }),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const privacyContacts = pgTable("privacy_contacts", {
  id: serial("id").primaryKey(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  consentPrivacy: boolean("consent_privacy").notNull().default(false),
  consentMarketing: boolean("consent_marketing").notNull().default(false),
  consentDate: ts("consent_date"),
  source: varchar("source", { length: 80 }),
  linkedUserId: integer("linked_user_id").references(() => users.id),
  importedAt: ts("imported_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: integer("actor_id").references(() => users.id),
  action: varchar("action", { length: 60 }).notNull(),
  entity: varchar("entity", { length: 40 }).notNull(),
  entityId: varchar("entity_id", { length: 40 }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  ip: varchar("ip", { length: 64 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Dog = typeof dogs.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Operator = typeof operators.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
