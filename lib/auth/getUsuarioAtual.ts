import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Usuario } from "@/lib/types/database.types";

export type UsuarioAtual = {
  user: { id: string; email: string | undefined };
  perfil: Usuario;
} | null;

// Compartilha a validação de autenticação e a consulta do perfil entre o
// layout e a página durante a mesma requisição de renderização.
export const getUsuarioAtual = cache(async (): Promise<UsuarioAtual> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!perfil) return null;

  return { user: { id: user.id, email: user.email }, perfil };
});
