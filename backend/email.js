import nodemailer from 'nodemailer';

let transporter;

function smtpTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !Number.isFinite(port) || !process.env.SMTP_FROM) {
    const error = new Error('邮箱登录服务尚未配置');
    error.statusCode = 503;
    throw error;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  return transporter;
}

export async function sendLoginCodeEmail({ to, code }) {
  await smtpTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Doco 登录验证码',
    text: `你的 Doco 登录验证码是：${code}\n\n验证码 10 分钟内有效。如非本人操作，请忽略此邮件。`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;color:#141413;line-height:1.6">
        <h1 style="font-size:20px;font-weight:600">登录 Doco</h1>
        <p>你的登录验证码是：</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">${code}</p>
        <p style="color:#5e5d59">验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p>
      </div>
    `,
  });
}
