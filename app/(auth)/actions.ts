"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type FormState =
  | { error: string; success?: never }
  | { success: string; error?: never }
  | null;

// ─── Login ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
});

export async function loginAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return { error: "E-mail ou senha incorretos." };

  redirect("/home");
}

// ─── Cadastro ────────────────────────────────────────────────────────────────

const cadastroSchema = z.object({
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("E-mail inválido"),
  password: z
    .string()
    .min(8, "Senha deve ter pelo menos 8 caracteres"),
});

export async function cadastrarAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = cadastroSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { nome, email, password } = parsed.data;

  // Restrict registration to a configured email domain
  const allowedDomain = process.env.ALLOWED_REGISTRATION_DOMAIN;
  if (!allowedDomain) {
    return { error: "Cadastro desativado. Contate o gestor." };
  }
  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
  if (emailDomain !== allowedDomain.toLowerCase()) {
    return { error: "Apenas e-mails corporativos são permitidos para cadastro." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // O trigger handle_new_user lê este campo para criar o perfil
      data: { nome },
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "Este e-mail já está cadastrado." };
    }
    return { error: "Erro ao criar conta. Tente novamente." };
  }

  redirect("/home");
}

// ─── Esqueci minha senha ──────────────────────────────────────────────────────

const emailSchema = z.string().email("E-mail inválido");

export async function esquecerSenhaAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const email = formData.get("email")?.toString() ?? "";
  const parsed = emailSchema.safeParse(email);

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl}/nova-senha`,
  });

  if (error) return { error: "Erro ao enviar e-mail. Tente novamente." };

  return { success: "Enviamos um link de redefinição para o seu e-mail." };
}

// ─── Nova senha (pós-reset) ───────────────────────────────────────────────────

const novaSenhaSchema = z
  .object({
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não coincidem",
    path: ["confirm"],
  });

export async function novaSenhaAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = novaSenhaSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) return { error: "Erro ao atualizar a senha. Tente novamente." };

  redirect("/home");
}
