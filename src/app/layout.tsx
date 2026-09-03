import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fluxo – Finanças do Casal",
  description:
    "Central financeira compartilhada: faturas, categorias, parcelas, previsões, orçamentos e metas do casal.",
  applicationName: "Fluxo",
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  // O app é lido em celular o tempo todo; travar o zoom prejudicaria
  // acessibilidade, então maximumScale fica livre de propósito.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              color: "var(--color-ink)",
            },
          }}
        />
      </body>
    </html>
  );
}
