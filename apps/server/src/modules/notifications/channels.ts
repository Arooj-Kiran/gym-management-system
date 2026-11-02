import type { NotificationChannel } from '@gms/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import { config, type AppConfig } from '../../config/env';

/** Where a message can go: the recipient's login email and best known mobile number. */
export interface DeliveryTarget {
  email: string | null;
  phoneE164: string | null;
}

export interface OutboundMessage {
  gymName: string;
  title: string;
  body: string;
  to: DeliveryTarget;
}

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; errorCode: string };

/**
 * One external channel. An adapter is only ever asked to send when missingEnv() is empty; a
 * channel without credentials is recorded as NOT_CONFIGURED by the dispatcher instead.
 */
export interface ChannelAdapter {
  channel: NotificationChannel;
  provider: string;
  requiredEnv: readonly string[];
  missingEnv(): string[];
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Provider calls give up after this long, so one slow provider cannot stall the queue. */
const SEND_TIMEOUT_MS = 10_000;

const missing = (values: Record<string, string | undefined>) =>
  Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);

/** Error codes are short and never contain message text, addresses or credentials. */
const errorCodeOf = (prefix: string, error: unknown) => {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'TIMEOUT';
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
    ? `${prefix}_${code}`
    : `${prefix}_ERROR`;
};

// --- Email (SMTP via nodemailer) --------------------------------------------------------------

export function emailChannel(smtp: AppConfig['smtp'] = config.smtp): ChannelAdapter {
  let transport: Transporter | undefined;
  const required = {
    SMTP_HOST: smtp.host,
    SMTP_USER: smtp.user,
    SMTP_PASSWORD: smtp.password,
    SMTP_FROM: smtp.from,
  };
  return {
    channel: 'EMAIL',
    provider: 'SMTP',
    requiredEnv: Object.keys(required),
    missingEnv: () => missing(required),
    async send(message) {
      if (!message.to.email) return { ok: false, errorCode: 'NO_EMAIL_ADDRESS' };
      transport ??= nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user!, pass: smtp.password! },
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });
      try {
        const info = await transport.sendMail({
          from: smtp.from,
          to: message.to.email,
          subject: `${message.title} — ${message.gymName}`,
          text: `${message.body}\n\n${message.gymName}`,
        });
        return { ok: true, providerMessageId: String(info.messageId).slice(0, 200) };
      } catch (error) {
        return { ok: false, errorCode: errorCodeOf('SMTP', error) };
      }
    },
  };
}

// --- SMS and WhatsApp (Twilio REST API over fetch, no SDK) ------------------------------------

type TwilioSettings = AppConfig['twilio'];

async function sendTwilioMessage(
  twilio: TwilioSettings,
  to: string,
  from: string,
  text: string,
): Promise<SendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    twilio.accountSid!,
  )}/Messages.json`;
  const credentials = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as {
      sid?: unknown;
      code?: unknown;
    } | null;
    if (response.ok && typeof payload?.sid === 'string') {
      return { ok: true, providerMessageId: payload.sid.slice(0, 200) };
    }
    return {
      ok: false,
      errorCode:
        typeof payload?.code === 'number' ? `TWILIO_${payload.code}` : `HTTP_${response.status}`,
    };
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf('NETWORK', error) };
  }
}

/** SMS bodies stay short: one or two segments. */
const smsText = (message: OutboundMessage) =>
  `${message.gymName}: ${message.title}. ${message.body}`.slice(0, 320);

export function smsChannel(twilio: TwilioSettings = config.twilio): ChannelAdapter {
  const required = {
    TWILIO_ACCOUNT_SID: twilio.accountSid,
    TWILIO_AUTH_TOKEN: twilio.authToken,
    TWILIO_SMS_FROM: twilio.smsFrom,
  };
  return {
    channel: 'SMS',
    provider: 'Twilio',
    requiredEnv: Object.keys(required),
    missingEnv: () => missing(required),
    send: (message) =>
      message.to.phoneE164
        ? sendTwilioMessage(twilio, message.to.phoneE164, twilio.smsFrom!, smsText(message))
        : Promise.resolve({ ok: false, errorCode: 'NO_PHONE_NUMBER' }),
  };
}

export function whatsappChannel(twilio: TwilioSettings = config.twilio): ChannelAdapter {
  const required = {
    TWILIO_ACCOUNT_SID: twilio.accountSid,
    TWILIO_AUTH_TOKEN: twilio.authToken,
    TWILIO_WHATSAPP_FROM: twilio.whatsappFrom,
  };
  return {
    channel: 'WHATSAPP',
    provider: 'Twilio WhatsApp',
    requiredEnv: Object.keys(required),
    missingEnv: () => missing(required),
    send: (message) =>
      message.to.phoneE164
        ? sendTwilioMessage(
            twilio,
            `whatsapp:${message.to.phoneE164}`,
            `whatsapp:${twilio.whatsappFrom}`,
            `*${message.title}*\n${message.body}\n— ${message.gymName}`,
          )
        : Promise.resolve({ ok: false, errorCode: 'NO_PHONE_NUMBER' }),
  };
}

/** The three channels as configured by the environment. */
export function defaultChannels(): ChannelAdapter[] {
  return [emailChannel(), smsChannel(), whatsappChannel()];
}
