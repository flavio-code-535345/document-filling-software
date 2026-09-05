// Email dispatch via nodemailer. Errors are logged but never thrown to the caller.
import nodemailer from "nodemailer";
import type { Settings } from "./types";

export async function sendFilledPdfEmail(
  settings: Settings,
  target: string,
  filename: string,
  pdfBytes: Uint8Array,
  templateName: string
): Promise<void> {
  const smtp = settings.smtp;
  if (!smtp.host || !smtp.from) return;
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    await transporter.sendMail({
      from: smtp.from,
      to: target,
      subject: `Ausgefülltes Dokument: ${templateName}`,
      text: `Anbei das ausgefüllte Dokument „${templateName}“.`,
      attachments: [
        { filename, content: Buffer.from(pdfBytes), contentType: "application/pdf" },
      ],
    });
  } catch (err) {
    console.error("[email] send failed:", err);
  }
}
