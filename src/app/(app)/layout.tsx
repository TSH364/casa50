import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { HouseSwitcher } from "@/components/house-switcher";
import { getActiveHouse } from "@/lib/houses";
import { getCurrentUser } from "@/lib/supabase/server";
import { signOut } from "@/app/entrar/actions";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // O middleware ja barra visitante, mas a checagem aqui evita depender de
  // um matcher de rota para uma garantia de acesso.
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const { active, houses } = await getActiveHouse();
  // Conta nova ainda sem casa: nao existe dado para mostrar.
  if (!active) redirect("/nova-casa");

  return (
    <div className="flex min-h-dvh">
      {/*
        Primeiro alvo do Tab: quem navega por teclado nao deveria percorrer os
        seis itens de navegacao a cada troca de pagina para chegar ao conteudo.
        Fica invisivel ate receber foco.
      */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[--radius-control] focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:text-white"
      >
        Pular para o conteúdo
      </a>

      <AppNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur-md sm:px-6">
          <HouseSwitcher houses={houses} activeId={active.id} />
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sair
            </Button>
          </form>
        </header>

        {/* pb-24 no celular reserva a altura da barra inferior fixa. */}
        <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
