/**
 * The ways a reminder can reach someone.
 *
 * Two today: email, and a push notification to a phone that has installed
 * the site and said yes. A text message would be a third — the shape is
 * here for it ("sms"), and nothing else in the app would need to change but
 * the sender in lib/reminders-db.ts and a column per reminder type.
 */
export type Channel = "email" | "push";

export const CHANNELS: Channel[] = ["email", "push"];

export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", push: "Push notification" };

export function isChannel(value: unknown): value is Channel {
  return value === "email" || value === "push";
}

/**
 * One notification, written once and sent by whichever channels apply:
 * the long form is the email, the short form fits a phone's lock screen.
 */
export type Notification = {
  subject: string;
  text: string;
  /** A sentence or two, for a push notification. */
  short: string;
  /** Where tapping it should land. */
  url: string;
  /** Pushes with the same tag replace each other on the phone. */
  tag?: string;
};
