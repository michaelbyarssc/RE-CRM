export const LEAD_STATUSES = [
  { value: "new", label: "New", color: "bg-blue-500" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-500" },
  { value: "in_process", label: "In Process", color: "bg-purple-500" },
  { value: "offer_sent", label: "Offer Sent", color: "bg-orange-500" },
  { value: "under_contract", label: "Under Contract", color: "bg-emerald-500" },
  { value: "closed", label: "Closed", color: "bg-green-600" },
  { value: "dead", label: "Dead", color: "bg-gray-500" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["value"];

export const STATUS_MAP = Object.fromEntries(
  LEAD_STATUSES.map((s) => [s.value, s])
) as Record<LeadStatus, (typeof LEAD_STATUSES)[number]>;

// CSV column auto-mapping
export const CSV_COLUMN_MAPPINGS: Record<string, string> = {
  // first name
  "first name": "firstName",
  "first_name": "firstName",
  "firstname": "firstName",
  "fname": "firstName",
  "owner first name": "firstName",
  "owner_first_name": "firstName",
  // last name
  "last name": "lastName",
  "last_name": "lastName",
  "lastname": "lastName",
  "lname": "lastName",
  "owner last name": "lastName",
  "owner_last_name": "lastName",
  // property address
  "property address": "propertyAddress",
  "property_address": "propertyAddress",
  "address": "propertyAddress",
  "street address": "propertyAddress",
  "property street": "propertyAddress",
  "site address": "propertyAddress",
  // property city
  "property city": "propertyCity",
  "property_city": "propertyCity",
  "city": "propertyCity",
  "site city": "propertyCity",
  // property state
  "property state": "propertyState",
  "property_state": "propertyState",
  "state": "propertyState",
  "site state": "propertyState",
  // property zip
  "property zip": "propertyZip",
  "property_zip": "propertyZip",
  "zip": "propertyZip",
  "zipcode": "propertyZip",
  "zip code": "propertyZip",
  "postal code": "propertyZip",
  "site zip": "propertyZip",
  // mailing address
  "mailing address": "mailingAddress",
  "mailing_address": "mailingAddress",
  "mail address": "mailingAddress",
  "owner address": "mailingAddress",
  // mailing city
  "mailing city": "mailingCity",
  "mailing_city": "mailingCity",
  "mail city": "mailingCity",
  "owner city": "mailingCity",
  // mailing state
  "mailing state": "mailingState",
  "mailing_state": "mailingState",
  "mail state": "mailingState",
  "owner state": "mailingState",
  // mailing zip
  "mailing zip": "mailingZip",
  "mailing_zip": "mailingZip",
  "mail zip": "mailingZip",
  "owner zip": "mailingZip",
  // phone
  "phone": "phone",
  "phone number": "phone",
  "phone_number": "phone",
  "telephone": "phone",
  "mobile": "phone",
  "cell": "phone",
  "contact phone": "phone",
  // email
  "email": "email",
  "email address": "email",
  "email_address": "email",
  "e-mail": "email",
  "contact email": "email",
};

export const EVENT_TYPES = [
  { value: "appointment", label: "Appointment", color: "bg-blue-500", hex: "#3B82F6" },
  { value: "callback", label: "Callback", color: "bg-yellow-500", hex: "#EAB308" },
  { value: "follow_up", label: "Follow-up", color: "bg-purple-500", hex: "#A855F7" },
  { value: "closing", label: "Closing", color: "bg-emerald-500", hex: "#10B981" },
  { value: "custom", label: "Custom", color: "bg-gray-500", hex: "#6B7280" },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["value"];

export const EVENT_TYPE_MAP = Object.fromEntries(
  EVENT_TYPES.map((e) => [e.value, e])
) as Record<EventType, (typeof EVENT_TYPES)[number]>;

export const EVENT_STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const LEAD_FIELD_OPTIONS = [
  { value: "firstName", label: "First Name" },
  { value: "lastName", label: "Last Name" },
  { value: "propertyAddress", label: "Property Address" },
  { value: "propertyCity", label: "Property City" },
  { value: "propertyState", label: "Property State" },
  { value: "propertyZip", label: "Property Zip" },
  { value: "mailingAddress", label: "Mailing Address" },
  { value: "mailingCity", label: "Mailing City" },
  { value: "mailingState", label: "Mailing State" },
  { value: "mailingZip", label: "Mailing Zip" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "skip", label: "-- Skip --" },
];
