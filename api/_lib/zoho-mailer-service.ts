import nodemailer, { Transporter } from 'nodemailer';

/**
 * E-mail transacional customizado da Invictus, enviado via SMTP da Zoho
 * (caixa noreply@invictusperformance.app.br). Existe porque o editor de
 * modelos de e-mail do Firebase Authentication está bloqueado para este
 * projeto especificamente ("atualizações de modelos de e-mail não estão
 * disponíveis para este projeto") -- o link de ação em si continua sendo
 * gerado e validado pelo próprio Firebase Admin SDK
 * (generateEmailVerificationLink); este arquivo só cuida do envelope/visual
 * do e-mail que carrega esse link.
 */

let cachedTransporter: Transporter | null = null;

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`E-mail indisponível no momento: ${name} não configurado.`);
  return value;
}

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = requiredEnv('ZOHO_SMTP_HOST');
  const port = Number(requiredEnv('ZOHO_SMTP_PORT'));
  const user = requiredEnv('ZOHO_SMTP_USER');
  const pass = requiredEnv('ZOHO_SMTP_PASSWORD');

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // 465 = SSL implícito (secure: true). Qualquer outra porta (ex.: 587) usa
    // STARTTLS, que o nodemailer já faz automaticamente com secure: false.
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export type SendInvictusEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendInvictusEmail(input: SendInvictusEmailInput): Promise<void> {
  const transporter = getTransporter();
  const from = requiredEnv('ZOHO_SMTP_USER');
  await transporter.sendMail({
    from: `"Invictus Performance" <${from}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Template do e-mail de confirmação de endereço. O link já vem pronto do
 * Firebase Admin (generateEmailVerificationLink) -- esta função só cuida da
 * apresentação visual com a marca Invictus.
 */
export function buildVerificationEmail(link: string): { subject: string; html: string; text: string } {
  const safeLink = escapeHtml(link);
  const subject = 'Confirme seu e-mail — Invictus Performance';
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#0b0e11;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0e11;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#14181d;border-radius:16px;overflow:hidden;border:1px solid #232830;">
            <tr>
              <td style="padding:32px 32px 24px 32px;text-align:center;border-bottom:1px solid #232830;">
                <span style="font-size:20px;font-weight:700;letter-spacing:2px;color:#ffffff;">INVICTUS <span style="color:#10b981;">PERFORMANCE</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px 0;color:#ffffff;font-size:22px;font-weight:600;">Confirme seu e-mail</h1>
                <p style="margin:0 0 24px 0;color:#a3adba;font-size:15px;line-height:1.6;">
                  Toque no botão abaixo para confirmar este endereço e liberar os recursos da sua conta, incluindo saques de premiações.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                  <tr>
                    <td style="border-radius:10px;background:linear-gradient(135deg,#10b981,#06b6d4);">
                      <a href="${safeLink}" style="display:inline-block;padding:14px 32px;color:#0b0e11;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;">
                        CONFIRMAR MEU E-MAIL
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;color:#5b6472;font-size:13px;line-height:1.6;">
                  Se o botão não funcionar, copie e cole este link no navegador:
                </p>
                <p style="margin:0;word-break:break-all;color:#06b6d4;font-size:13px;line-height:1.6;">
                  ${safeLink}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #232830;text-align:center;">
                <p style="margin:0;color:#5b6472;font-size:12px;">
                  Se você não solicitou isso, pode ignorar este e-mail com segurança.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `Confirme seu e-mail na Invictus Performance:\n\n${link}\n\nSe você não solicitou isso, pode ignorar este e-mail com segurança.`;
  return { subject, html, text };
}
