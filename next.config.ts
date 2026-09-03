import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Bibliotecas de importacao (xlsx/pdfjs) entram na Etapa 3 e sao pesadas:
    // mantemos o bundle do servidor enxuto ate la.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
