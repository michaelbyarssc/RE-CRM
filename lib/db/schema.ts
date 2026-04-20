import { pgTable, text, integer, real, serial } from "drizzle-orm/pg-core";

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  propertyAddress: text("property_address").notNull(),
  propertyCity: text("property_city"),
  propertyState: text("property_state"),
  propertyZip: text("property_zip"),
  mailingAddress: text("mailing_address"),
  mailingCity: text("mailing_city"),
  mailingState: text("mailing_state"),
  mailingZip: text("mailing_zip"),
  phone: text("phone"),
  email: text("email"),
  status: text("status").default("new").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  source: text("source"),
  customData: text("custom_data"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").default("#6B7280").notNull(),
});

export const leadTags = pgTable("lead_tags", {
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const sequences = pgTable("sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active").default(1).notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  delayDays: integer("delay_days").notNull(),
  actionType: text("action_type").notNull(),
  template: text("template"),
});

export const leadSequences = pgTable("lead_sequences", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").default(0).notNull(),
  status: text("status").default("active").notNull(),
  enrolledAt: text("enrolled_at").notNull().$defaultFn(() => new Date().toISOString()),
  nextActionAt: text("next_action_at"),
});

export const callLog = pgTable("call_log", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction"),
  duration: integer("duration"),
  disposition: text("disposition"),
  notes: text("notes"),
  calledAt: text("called_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const skipTraceResults = pgTable("skip_trace_results", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  phones: text("phones"),
  emails: text("emails"),
  provider: text("provider"),
  tracedAt: text("traced_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const csvImports = pgTable("csv_imports", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  totalRows: integer("total_rows"),
  importedRows: integer("imported_rows"),
  skippedRows: integer("skipped_rows"),
  columnMapping: text("column_mapping"),
  importedAt: text("imported_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const buyers = pgTable("buyers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  buyCriteria: text("buy_criteria"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  filepath: text("filepath").notNull(),
  fileType: text("file_type"),
  uploadedAt: text("uploaded_at").notNull().$defaultFn(() => new Date().toISOString()),
});
