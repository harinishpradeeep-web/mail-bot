export type ScheduleType = 'now' | 'once' | 'repeat';
export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ScheduleStatus = 'active' | 'scheduled' | 'processing' | 'paused' | 'failed' | 'completed';
export type SendStatus = 'sent' | 'failed' | 'pending';

/** Weekdays as ISO numbers: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface User {
  id: number;
  google_id: string;
  email: string;
  name: string;
  gmail_connected: 0 | 1;
  created_at: string;
}

export interface Recipient {
  id: number;
  user_id: number;
  name: string;
  email: string;
  department: string | null;
  notes: string | null;
  created_at: string;
}

export interface ScheduledEmail {
  id: number;
  user_id: number;
  subject: string;
  body: string;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  timezone: string;
  repeat_frequency: RepeatFrequency | null;
  repeat_days: string | null;
  repeat_interval_days: number | null;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  next_send_at: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: number;
  scheduled_email_id: number;
  recipient_email: string;
  occurrence_key: string;
  sent_at: string | null;
  status: SendStatus;
  error_message: string | null;
}

/** Everything needed to work out when a schedule fires next. */
export interface RecurrenceSpec {
  scheduleType: ScheduleType;
  timezone: string;
  /** yyyy-MM-dd */
  startDate: string;
  /** HH:mm (24h) */
  startTime: string;
  repeatFrequency?: RepeatFrequency | null;
  /** ISO weekdays, only for weekly */
  repeatDays?: Weekday[] | null;
  /** only for custom: fire every N days */
  repeatIntervalDays?: number | null;
  /** yyyy-MM-dd, inclusive. null = no end date */
  endDate?: string | null;
}
