/**
 * Parses a note for date/time references and addresses to auto-create calendar events.
 * Returns event details if a schedulable action is detected, null otherwise.
 */

interface ParsedEvent {
  title: string;
  eventType: "appointment" | "callback" | "follow_up";
  startAt: string; // ISO string
  location?: string;
}

// Day-of-week names
const DAYS_OF_WEEK: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

// Patterns that suggest a callback
const CALLBACK_PATTERNS = [
  /call\s*(?:back|again)/i,
  /callback/i,
  /follow\s*up/i,
  /check\s*(?:back|in)/i,
  /reach\s*out/i,
  /ring\s*(?:back|again)/i,
  /phone\s*(?:back|again)/i,
  /touch\s*base/i,
  /get\s*back\s*(?:to|with)/i,
];

// Patterns that suggest a meeting/appointment
const MEETING_PATTERNS = [
  /meet\s*(?:at|with)?/i,
  /walk\s*(?:the\s+)?(?:property|house|home)/i,
  /show\s*(?:the\s+)?(?:property|house|home)/i,
  /visit/i,
  /go\s*(?:to|see|look|check)/i,
  /appointment/i,
  /showing/i,
  /drive\s*by/i,
  /inspect/i,
  /look\s*at/i,
  /view\s*(?:the\s+)?(?:property|house|home)/i,
];

function parseTime(text: string): { hours: number; minutes: number } | null {
  // Match: 2pm, 2:30pm, 2:30 pm, 14:00, 2 PM, etc.
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3].toLowerCase().replace(/\./g, "");
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  // 24-hour format: 14:00, 09:30
  const time24Match = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (time24Match) {
    const hours = parseInt(time24Match[1]);
    const minutes = parseInt(time24Match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }

  // Simple hour references: "at 2", "at 10" (assume business hours context)
  const simpleHour = text.match(/\bat\s+(\d{1,2})\b(?!\s*(?:\d|st|nd|rd|th|\/|-|:))/i);
  if (simpleHour) {
    let hours = parseInt(simpleHour[1]);
    // Assume PM for hours 1-6 in business context
    if (hours >= 1 && hours <= 6) hours += 12;
    if (hours >= 7 && hours <= 23) {
      return { hours, minutes: 0 };
    }
  }

  return null;
}

function parseDate(text: string, referenceDate: Date = new Date()): Date | null {
  const lower = text.toLowerCase();

  // "today"
  if (/\btoday\b/i.test(lower)) {
    return new Date(referenceDate);
  }

  // "tomorrow"
  if (/\btomorrow\b/i.test(lower)) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // "next [day]" or just "[day]" — e.g. "next Tuesday", "Thursday"
  for (const [name, dayNum] of Object.entries(DAYS_OF_WEEK)) {
    const regex = new RegExp(`\\b(?:next\\s+)?${name}\\b`, "i");
    if (regex.test(lower)) {
      const d = new Date(referenceDate);
      const currentDay = d.getDay();
      let daysAhead = dayNum - currentDay;
      if (daysAhead <= 0) daysAhead += 7; // Always go forward
      d.setDate(d.getDate() + daysAhead);
      return d;
    }
  }

  // "in X days/hours"
  const inDays = lower.match(/\bin\s+(\d+)\s+day/i);
  if (inDays) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() + parseInt(inDays[1]));
    return d;
  }

  const inHours = lower.match(/\bin\s+(\d+)\s+hour/i);
  if (inHours) {
    const d = new Date(referenceDate);
    d.setUTCHours(d.getUTCHours() + parseInt(inHours[1]));
    return d;
  }

  // "Month Day" — e.g. "April 25", "Jan 3"
  for (const [name, monthNum] of Object.entries(MONTH_NAMES)) {
    const regex = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
    const match = lower.match(regex);
    if (match) {
      const day = parseInt(match[1]);
      const d = new Date(referenceDate);
      d.setUTCMonth(monthNum, day);
      // If the date is in the past, push to next year
      if (d < referenceDate) d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d;
    }
  }

  // MM/DD or MM/DD/YYYY
  const slashDate = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    const month = parseInt(slashDate[1]) - 1;
    const day = parseInt(slashDate[2]);
    let year = slashDate[3] ? parseInt(slashDate[3]) : referenceDate.getUTCFullYear();
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day));
    if (d < referenceDate && !slashDate[3]) d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d;
  }

  return null;
}

function parseAddress(text: string): string | null {
  // Match common US address patterns: "123 Main St", "456 Oak Ave", etc.
  const addressMatch = text.match(
    /\b(\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-zA-Z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Cir(?:cle)?|Pkwy|Hwy|Highway)\.?)\b/i
  );
  if (addressMatch) return addressMatch[1];

  // Match "at [address]" pattern
  const atAddress = text.match(
    /\bat\s+(\d{1,6}\s+[A-Za-z\s]+?)(?:\s*[,.]|\s+(?:at|on|in|for|to|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))|\s*$)/i
  );
  if (atAddress && atAddress[1].trim().split(/\s+/).length >= 2) {
    return atAddress[1].trim();
  }

  return null;
}

export function parseNoteForEvent(
  noteContent: string,
  leadName: string,
  timezoneOffsetMinutes?: number
): ParsedEvent | null {
  const text = noteContent.trim();

  // Must have some date/time reference
  const parsedDate = parseDate(text);
  const parsedTime = parseTime(text);

  // No temporal reference at all — skip
  if (!parsedDate && !parsedTime) return null;

  // Build the datetime
  // Use timezone offset from client to correctly interpret user's local time
  // timezoneOffsetMinutes: minutes behind UTC (e.g. EDT = 240, PDT = 420)
  const tzOffset = timezoneOffsetMinutes ?? new Date().getTimezoneOffset();
  const eventDate = parsedDate || new Date();

  if (parsedTime) {
    // Set time in UTC, adjusted for user's timezone
    // User says "6 pm" meaning 6 PM local → convert to UTC
    const utcHours = parsedTime.hours + Math.floor(tzOffset / 60);
    const utcMinutes = parsedTime.minutes + (tzOffset % 60);
    eventDate.setUTCHours(utcHours, utcMinutes, 0, 0);
  } else {
    // Default to 9 AM local time if only a date is mentioned
    const utcHours = 9 + Math.floor(tzOffset / 60);
    const utcMinutes = tzOffset % 60;
    eventDate.setUTCHours(utcHours, utcMinutes, 0, 0);
  }

  // Don't create events for dates clearly in the past (more than 1 hour ago)
  // Use a buffer to account for edge cases and processing delay
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (eventDate < oneHourAgo) {
    // If a specific date was given and it's clearly past, skip
    if (parsedDate) return null;
    // If only time was given and it's past, assume tomorrow
    eventDate.setDate(eventDate.getDate() + 1);
  }

  // Determine event type
  let eventType: ParsedEvent["eventType"] = "follow_up";
  let title = "";

  const isMeeting = MEETING_PATTERNS.some((p) => p.test(text));
  const isCallback = CALLBACK_PATTERNS.some((p) => p.test(text));

  // Check for address
  const address = parseAddress(text);

  if (isMeeting || address) {
    eventType = "appointment";
    title = `Property visit — ${leadName}`;
  } else if (isCallback) {
    eventType = "callback";
    title = `Call back ${leadName}`;
  } else {
    eventType = "follow_up";
    title = `Follow up with ${leadName}`;
  }

  const result: ParsedEvent = {
    title,
    eventType,
    startAt: eventDate.toISOString(),
  };

  if (address) {
    result.location = address;
  }

  return result;
}
