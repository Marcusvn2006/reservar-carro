import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/cadastrar", "/esqueci-senha"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Navegações de tela usam a sessão local apenas para decidir redirects de
  // UX. A validação autoritativa continua nas páginas via getUsuarioAtual().
  // APIs mantêm getUser() para não reduzir a proteção das rotas existentes.
  const autenticado = pathname.startsWith("/api/")
    ? Boolean((await supabase.auth.getUser()).data.user)
    : Boolean((await supabase.auth.getSession()).data.session);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!autenticado && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (autenticado && isPublic) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons|manifest.json|.*\\.png$|.*\\.svg$).*)",
  ],
};
