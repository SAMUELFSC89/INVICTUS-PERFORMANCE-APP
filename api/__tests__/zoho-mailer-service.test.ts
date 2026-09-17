/**
 * Testes do serviço de e-mail transacional da Invictus via SMTP da Zoho.
 * O nodemailer é mockado -- não fazemos conexão SMTP real em teste.
 */

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test' });
const createTransportMock = jest.fn((..._args: any[]) => ({ sendMail: sendMailMock }));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (...args: any[]) => createTransportMock(...args) },
  createTransport: (...args: any[]) => createTransportMock(...args),
}));

const ORIGINAL_ENV = { ...process.env };

function setZohoEnv(overrides: Partial<Record<string, string>> = {}) {
  process.env.ZOHO_SMTP_HOST = 'smtp.zoho.com';
  process.env.ZOHO_SMTP_PORT = '465';
  process.env.ZOHO_SMTP_USER = 'noreply@invictusperformance.app.br';
  process.env.ZOHO_SMTP_PASSWORD = 'segredo-de-teste';
  Object.assign(process.env, overrides);
}

describe('zoho-mailer-service', () => {
  beforeEach(() => {
    jest.resetModules();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('buildVerificationEmail inclui o link, a marca Invictus e escapa HTML no link', async () => {
    const { buildVerificationEmail } = await import('../_lib/zoho-mailer-service.js');
    const link = 'https://invictusperformance.app.br/__/auth/action?mode=verifyEmail&oobCode=abc&continueUrl=https://x.com/?a=1&b=2';

    const { subject, html, text } = buildVerificationEmail(link);

    expect(subject).toContain('Invictus Performance');
    expect(html).toContain('INVICTUS');
    expect(html).toContain('PERFORMANCE');
    expect(html).toContain('CONFIRMAR MEU E-MAIL');
    // & vira &amp; dentro do HTML -- garante que a URL com múltiplos parâmetros não quebra o markup
    expect(html).toContain('oobCode=abc&amp;continueUrl');
    expect(html).not.toContain('oobCode=abc&continueUrl');
    expect(text).toContain(link);
  });

  test('sendInvictusEmail monta o transporte com host/porta/credenciais da Zoho e envia com o remetente correto', async () => {
    setZohoEnv();
    const { sendInvictusEmail } = await import('../_lib/zoho-mailer-service.js');

    await sendInvictusEmail({
      to: 'atleta@example.com',
      subject: 'Assunto',
      html: '<p>oi</p>',
      text: 'oi',
    });

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: 'noreply@invictusperformance.app.br', pass: 'segredo-de-teste' },
    }));
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: '"Invictus Performance" <noreply@invictusperformance.app.br>',
      to: 'atleta@example.com',
      subject: 'Assunto',
    }));
  });

  test('porta 587 usa STARTTLS (secure: false) em vez de SSL implícito', async () => {
    setZohoEnv({ ZOHO_SMTP_PORT: '587' });
    const { sendInvictusEmail } = await import('../_lib/zoho-mailer-service.js');

    await sendInvictusEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  test('lança erro claro quando falta variável de ambiente da Zoho', async () => {
    setZohoEnv({ ZOHO_SMTP_PASSWORD: '' });
    const { sendInvictusEmail } = await import('../_lib/zoho-mailer-service.js');

    await expect(sendInvictusEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }))
      .rejects.toThrow('ZOHO_SMTP_PASSWORD');
  });
});
