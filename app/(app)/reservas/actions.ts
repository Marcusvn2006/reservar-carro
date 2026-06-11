"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import {
  enviarEmailNovaSolicitacao,
  enviarEmailReservaAprovada,
  enviarEmailReservaRecusada,
  enviarEmailReservaCriadaPeloGestor,
} from "@/lib/email";

export type ReservaFormState =
  | { error: string; success?: never; conflito?: never }
  | { success: string; error?: never; conflito?: never }
  | { conflito: string; error?: never; success?: never }
  | null;

// Converte "YYYY-MM-DDTHH:mm" (input local BRT) → ISO com timezone BRT
function toBRT(local: string): string {
  return local + ":00-03:00";
}

// Extrai destinos do FormData (destino_0, destino_1, …)
function getDestinos(formData: FormData): string[] {
  const map: Record<number, string> = {};
  formData.forEach((value, key) => {
    if (key.startsWith("destino_")) {
      const idx = parseInt(key.replace("destino_", ""), 10);
      if (typeof value === "string" && value.trim()) {
        map[idx] = value.trim();
      }
    }
  });
  return Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => map[k]);
}

const reservaSchema = z
  .object({
    motorista: z.string().min(2, "Nome do motorista deve ter pelo menos 2 caracteres"),
    inicio: z.string().min(1, "Data/hora de início obrigatória"),
    fim: z.string().min(1, "Data/hora de fim obrigatória"),
  })
  .refine((d) => new Date(d.fim) > new Date(d.inicio), {
    message: "O horário de fim deve ser após o início",
    path: ["fim"],
  });

// ─── Helper: busca e-mail de usuário pelo ID via admin client ─────────────────

async function getEmailById(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

async function getGestorEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("usuarios")
      .select("id")
      .eq("papel", "gestor")
      .limit(1)
      .single();
    if (!data?.id) return null;
    return getEmailById(data.id);
  } catch {
    return null;
  }
}

// ─── Funcionário cria reserva (pendente, sem veículo) ─────────────────────────

export async function criarReservaAction(
  _prev: ReservaFormState,
  formData: FormData
): Promise<ReservaFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const parsed = reservaSchema.safeParse({
    motorista: formData.get("motorista"),
    inicio: formData.get("inicio"),
    fim: formData.get("fim"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const destinos = getDestinos(formData);
  if (destinos.length === 0) return { error: "Adicione pelo menos um destino." };

  const { data: reserva, error } = await supabase
    .from("reservas")
    .insert({
      solicitante_id: user.id,
      motorista_id: user.id,
      motorista: parsed.data.motorista,
      inicio: toBRT(parsed.data.inicio),
      fim: toBRT(parsed.data.fim),
      status: "pendente",
      origem: "solicitacao",
    })
    .select("id")
    .single();

  if (error || !reserva) return { error: "Erro ao criar reserva. Tente novamente." };

  await supabase.from("reserva_destinos").insert(
    destinos.map((d, i) => ({ reserva_id: reserva.id, destino: d, ordem: i + 1 }))
  );

  // Notifica o gestor da nova solicitação após o redirect
  const _reservaId = reserva.id;
  const _motorista = parsed.data.motorista;
  const _inicio = toBRT(parsed.data.inicio);
  const _fim = toBRT(parsed.data.fim);
  const _destinos = destinos;
  after(async () => {
    const gestorEmail = await getGestorEmail();
    if (!gestorEmail) return;
    await enviarEmailNovaSolicitacao({
      to: gestorEmail,
      solicitante: _motorista,
      motorista: _motorista,
      inicio: _inicio,
      fim: _fim,
      destinos: _destinos,
      reservaId: _reservaId,
    });
  });

  revalidatePath("/reservas");
  redirect("/reservas");
}

// ─── Gestor cria reserva diretamente (aprovada, com veículo) ─────────────────

const reservaGestorSchema = reservaSchema.and(
  z.object({ veiculo_id: z.string().uuid("Selecione um veículo") })
);

export async function criarReservaGestorAction(
  _prev: ReservaFormState,
  formData: FormData
): Promise<ReservaFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .single();
  if (perfil?.papel !== "gestor") return { error: "Acesso negado." };

  const parsed = reservaGestorSchema.safeParse({
    motorista: formData.get("motorista"),
    inicio: formData.get("inicio"),
    fim: formData.get("fim"),
    veiculo_id: formData.get("veiculo_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const destinos = getDestinos(formData);
  if (destinos.length === 0) return { error: "Adicione pelo menos um destino." };

  const inicioISO = toBRT(parsed.data.inicio);
  const fimISO = toBRT(parsed.data.fim);

  // Verificar conflito
  const { data: conflitos } = await supabase
    .from("reservas")
    .select("id")
    .eq("veiculo_id", parsed.data.veiculo_id)
    .eq("status", "aprovada")
    .lt("inicio", fimISO)
    .gt("fim", inicioISO);

  const forcar = formData.get("forcar") === "1";
  if (conflitos && conflitos.length > 0 && !forcar) {
    return {
      conflito:
        "Este veículo já possui reserva aprovada neste período. Confirmar mesmo assim?",
    };
  }

  const motoristaId = (formData.get("motorista_id") as string) || null;

  const { data: reserva, error } = await supabase
    .from("reservas")
    .insert({
      solicitante_id: user.id,
      motorista_id: motoristaId,
      motorista: parsed.data.motorista,
      inicio: inicioISO,
      fim: fimISO,
      veiculo_id: parsed.data.veiculo_id,
      status: "aprovada",
      origem: "gestor",
    })
    .select("id")
    .single();

  if (error || !reserva) return { error: "Erro ao criar reserva. Tente novamente." };

  await supabase.from("reserva_destinos").insert(
    destinos.map((d, i) => ({ reserva_id: reserva.id, destino: d, ordem: i + 1 }))
  );

  // Notifica o motorista que uma reserva foi criada para ele
  if (motoristaId) {
    const _mId = motoristaId;
    const _motoristaNome = parsed.data.motorista;
    const _veiculoId = parsed.data.veiculo_id;
    const _inicio = inicioISO;
    const _fim = fimISO;
    const _destinos = destinos;
    const _reservaId = reserva.id;
    after(async () => {
      const [email, { data: v }] = await Promise.all([
        getEmailById(_mId),
        supabase.from("veiculos").select("modelo, placa").eq("id", _veiculoId).single(),
      ]);
      if (!email || !v) return;
      await enviarEmailReservaCriadaPeloGestor({
        to: email,
        motorista: _motoristaNome,
        veiculo: `${v.modelo} · ${v.placa}`,
        inicio: _inicio,
        fim: _fim,
        destinos: _destinos,
        reservaId: _reservaId,
      });
    });
  }

  revalidatePath("/reservas");
  redirect("/reservas");
}

// ─── Gestor aprova + atribui veículo ─────────────────────────────────────────

export async function aprovarReservaAction(
  id: string,
  _prev: ReservaFormState,
  formData: FormData
): Promise<ReservaFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .single();
  if (perfil?.papel !== "gestor") return { error: "Acesso negado." };

  const veiculo_id = formData.get("veiculo_id") as string;
  if (!veiculo_id) return { error: "Selecione um veículo." };

  const { data: reserva } = await supabase
    .from("reservas")
    .select(`
      inicio, fim, motorista, solicitante_id, motorista_id,
      veiculo:veiculos!reservas_veiculo_id_fkey(modelo, placa),
      destinos:reserva_destinos(destino, ordem)
    `)
    .eq("id", id)
    .single();
  if (!reserva) return { error: "Reserva não encontrada." };

  // Verificar conflito (excluindo a própria reserva)
  const { data: conflitos } = await supabase
    .from("reservas")
    .select("id")
    .eq("veiculo_id", veiculo_id)
    .eq("status", "aprovada")
    .neq("id", id)
    .lt("inicio", reserva.fim)
    .gt("fim", reserva.inicio);

  const forcar = formData.get("forcar") === "1";
  if (conflitos && conflitos.length > 0 && !forcar) {
    return {
      conflito:
        "Este veículo já possui reserva aprovada neste período. Confirmar mesmo assim?",
    };
  }

  // Se ainda não tem motorista_id, assume que o motorista é o próprio solicitante
  const novoMotoristaId = reserva.motorista_id ?? reserva.solicitante_id ?? null;

  const { error } = await supabase
    .from("reservas")
    .update({ status: "aprovada", veiculo_id, motorista_id: novoMotoristaId })
    .eq("id", id);

  if (error) return { error: "Erro ao aprovar reserva." };

  // Notifica o motorista da aprovação
  const _motoristaNome = (reserva as any).motorista as string;
  const _veiculoData = (reserva as any).veiculo as { modelo: string; placa: string } | null;
  const _destinosData = (reserva as any).destinos as { destino: string; ordem: number }[];
  const _emailTargetId = novoMotoristaId;
  const _inicio = reserva.inicio;
  const _fim = reserva.fim;
  const _id = id;
  if (_emailTargetId && _veiculoData) {
    after(async () => {
      const email = await getEmailById(_emailTargetId);
      if (!email) return;
      const destinosOrdenados = [..._destinosData]
        .sort((a, b) => a.ordem - b.ordem)
        .map((d) => d.destino);
      await enviarEmailReservaAprovada({
        to: email,
        motorista: _motoristaNome,
        veiculo: `${_veiculoData.modelo} · ${_veiculoData.placa}`,
        inicio: _inicio,
        fim: _fim,
        destinos: destinosOrdenados,
        reservaId: _id,
      });
    });
  }

  revalidatePath("/reservas");
  revalidatePath(`/reservas/${id}`);
  return { success: "Reserva aprovada com sucesso." };
}

// ─── Gestor recusa ────────────────────────────────────────────────────────────

export async function recusarReservaAction(id: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .single();
  if (perfil?.papel !== "gestor") return;

  const motivo = (formData.get("motivo") as string | null)?.trim() || null;

  // Busca dados para o e-mail antes de recusar (sem motorista_id — coluna pode não existir ainda)
  const { data: reserva } = await supabase
    .from("reservas")
    .select(`
      inicio, fim, motorista, solicitante_id,
      destinos:reserva_destinos(destino, ordem)
    `)
    .eq("id", id)
    .single();

  await supabase
    .from("reservas")
    .update({ status: "recusada", motivo_recusa: motivo })
    .eq("id", id);

  // Notifica o solicitante da recusa
  if (reserva?.solicitante_id) {
    const _solicitanteId = reserva.solicitante_id;
    const _motorista = (reserva as any).motorista as string;
    const _inicio = reserva.inicio;
    const _fim = reserva.fim;
    const _destinos = [...((reserva as any).destinos ?? [])]
      .sort((a: { ordem: number }, b: { ordem: number }) => a.ordem - b.ordem)
      .map((d: { destino: string }) => d.destino);
    after(async () => {
      const email = await getEmailById(_solicitanteId);
      if (!email) return;
      await enviarEmailReservaRecusada({
        to: email,
        motorista: _motorista,
        inicio: _inicio,
        fim: _fim,
        destinos: _destinos,
      });
    });
  }

  revalidatePath("/reservas");
  revalidatePath(`/reservas/${id}`);
}

// ─── Funcionário cancela própria solicitação pendente ────────────────────────

export async function cancelarPropriaSolicitacaoAction(id: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Verifica que a reserva existe, é pendente e pertence ao solicitante
  const { data: reserva } = await supabase
    .from("reservas")
    .select("solicitante_id, status")
    .eq("id", id)
    .single();

  if (!reserva) return;
  if (reserva.status !== "pendente") return;
  if (reserva.solicitante_id !== user.id) return;

  // UPDATE via admin para contornar RLS (as verificações de posse já foram feitas acima)
  const admin = createAdminClient();
  await admin.from("reservas").update({ status: "recusada" }).eq("id", id);

  revalidatePath("/reservas");
  revalidatePath("/minhas-reservas");
  redirect("/minhas-reservas");
}

// ─── Gestor cancela ───────────────────────────────────────────────────────────

export async function cancelarReservaAction(id: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .single();
  if (perfil?.papel !== "gestor") return;

  await supabase
    .from("reservas")
    .update({ status: "recusada" })
    .eq("id", id)
    .in("status", ["pendente", "aprovada"]);

  revalidatePath("/reservas");
  redirect("/reservas");
}
