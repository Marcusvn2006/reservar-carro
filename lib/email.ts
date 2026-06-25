"use server";

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "ReservarCarro <onboarding@resend.dev>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://reservar-carro.vercel.app/";

function fmtData(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function base(titulo: string, conteudo: string) {
  return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="500" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:#1a56db;padding:24px 28px;">
  <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">ReservarCarro</p>
  <p style="margin:4px 0 0;color:#93c5fd;font-size:13px;">Sistema de gestão de frota</p>
</td></tr>
<tr><td style="padding:28px;">
  <h2 style="margin:0 0 20px;font-size:18px;color:#111827;">${titulo}</h2>
  ${conteudo}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="margin:0;font-size:12px;color:#9ca3af;">Este é um e-mail automático — não responda.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function linha(label: string, valor: string) {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#6b7280;width:110px;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:bold;">${valor}</td>
  </tr>`;
}

function botao(texto: string, href: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold;">${texto}</a>`;
}

// ─── Gestor: nova solicitação ─────────────────────────────────────────────────

export async function enviarEmailNovaSolicitacao(p: {
  to: string;
  solicitante: string;
  motorista: string;
  inicio: string;
  fim: string;
  destinos: string[];
  reservaId: string;
}) {
  if (!process.env.RESEND_API_KEY) return;

  const destino = p.destinos.join(", ") || "—";
  const conteudo = `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      <strong>${p.solicitante}</strong> fez uma nova solicitação de reserva.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${p.solicitante !== p.motorista ? linha("Motorista", p.motorista) : ""}
      ${linha("Saída", fmtData(p.inicio))}
      ${linha("Retorno", fmtData(p.fim))}
      ${linha("Destino", destino)}
    </table>
    ${botao("Ver solicitação →", `${SITE_URL}/reservas/${p.reservaId}`)}
  `;

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Nova solicitação de reserva — ${p.solicitante}`,
    html: base("Nova solicitação de reserva", conteudo),
  }).catch(() => {});
}

// ─── Funcionário: reserva aprovada ───────────────────────────────────────────

export async function enviarEmailReservaAprovada(p: {
  to: string;
  motorista: string;
  veiculo: string;
  inicio: string;
  fim: string;
  destinos: string[];
  reservaId: string;
}) {
  if (!process.env.RESEND_API_KEY) return;

  const destino = p.destinos.join(", ") || "—";
  const conteudo = `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Olá, <strong>${p.motorista}</strong>! Sua reserva foi aprovada.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${linha("Veículo", p.veiculo)}
      ${linha("Saída", fmtData(p.inicio))}
      ${linha("Retorno", fmtData(p.fim))}
      ${linha("Destino", destino)}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
      Antes de sair, faça a vistoria de saída pelo aplicativo.
    </p>
    ${botao("Fazer vistoria de saída →", `${SITE_URL}/checklist/${p.reservaId}`)}
  `;

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Reserva aprovada — ${p.veiculo}`,
    html: base("Reserva aprovada", conteudo),
  }).catch(() => {});
}

// ─── Funcionário: reserva recusada ───────────────────────────────────────────

export async function enviarEmailReservaRecusada(p: {
  to: string;
  motorista: string;
  inicio: string;
  fim: string;
  destinos: string[];
}) {
  if (!process.env.RESEND_API_KEY) return;

  const destino = p.destinos.join(", ") || "—";
  const conteudo = `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Olá, <strong>${p.motorista}</strong>. Sua solicitação de reserva não foi aprovada.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${linha("Saída", fmtData(p.inicio))}
      ${linha("Retorno", fmtData(p.fim))}
      ${linha("Destino", destino)}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
      Se precisar, faça uma nova solicitação pelo aplicativo.
    </p>
    ${botao("Fazer nova solicitação →", `${SITE_URL}/reservas/nova`)}
  `;

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Reserva não aprovada`,
    html: base("Reserva não aprovada", conteudo),
  }).catch(() => {});
}

// ─── Funcionário: reserva criada pelo gestor ─────────────────────────────────

export async function enviarEmailReservaCriadaPeloGestor(p: {
  to: string;
  motorista: string;
  veiculo: string;
  inicio: string;
  fim: string;
  destinos: string[];
  reservaId: string;
}) {
  if (!process.env.RESEND_API_KEY) return;

  const destino = p.destinos.join(", ") || "—";
  const conteudo = `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Olá, <strong>${p.motorista}</strong>! Uma reserva foi criada para você.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${linha("Veículo", p.veiculo)}
      ${linha("Saída", fmtData(p.inicio))}
      ${linha("Retorno", fmtData(p.fim))}
      ${linha("Destino", destino)}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
      Antes de sair, não esqueça de fazer a vistoria de saída.
    </p>
    ${botao("Ver reserva →", `${SITE_URL}/checklist/${p.reservaId}`)}
  `;

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `Reserva criada para você — ${p.veiculo}`,
    html: base("Nova reserva criada", conteudo),
  }).catch(() => {});
}
