// Sends transactional email via Resend.
// Falls back to console.log when RESEND_API_KEY is unset (local dev).

export async function sendContactEmail(
  to: string,
  name: string,
  replyTo: string,
  message: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESET_FROM_EMAIL ?? "noreply@roamingbrush.art";

  if (!apiKey) {
    console.log(`[email] Contact from ${name} <${replyTo}>: ${message}`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from,
    to,
    replyTo,
    subject: `Message from ${name}`,
    html: `<p><strong>${name}</strong> (${replyTo}) sent you a message:</p><p>${message.replace(/\n/g, "<br>")}</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESET_FROM_EMAIL ?? "noreply@roamingbrush.art";

  if (!apiKey) {
    console.log(`[email] Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from,
    to,
    subject: "Reset your password",
    html: `
      <p>You requested a password reset for your gallery admin account.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
    `.trim(),
  });
}
