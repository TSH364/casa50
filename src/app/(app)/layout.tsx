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
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
