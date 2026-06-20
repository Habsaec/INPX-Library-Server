/**
 * Password reset via e-reader email.
 */
import { config } from '../config.js';
import { getPublicBaseUrlSetting } from '../db.js';
import { createSmtpTransport } from './email.js';
import { getSiteName } from '../templates/shared.js';
import { t, tp } from '../i18n.js';

/**
 * @param {import('express').Request} req
 */
export function resolvePublicBaseUrl(req) {
  const fromSetting = getPublicBaseUrlSetting();
  if (fromSetting) return fromSetting;
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const host = req.get('host');
  if (!host) return '';
  const proto = req.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * @param {{ to: string, resetUrl: string, username: string }} params
 */
export async function sendPasswordResetEmail({ to, resetUrl, username }) {
  const { transporter, senderEmail } = createSmtpTransport();
  const siteName = getSiteName() || 'INPX Library';
  const subject = tp('passwordReset.emailSubject', { site: siteName });
  const text = [
    tp('passwordReset.emailGreeting', { site: siteName }),
    '',
    t('passwordReset.emailBody'),
    '',
    resetUrl,
    '',
    tp('passwordReset.emailExpiry', { hours: '1' }),
    '',
    t('passwordReset.emailIgnore')
  ].join('\n');

  await transporter.sendMail({
    from: senderEmail,
    to,
    subject,
    text
  });
}
