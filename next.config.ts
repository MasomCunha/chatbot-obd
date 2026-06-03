import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse não deve ser empacotado pelo bundler do servidor — é um pacote
  // Node que corre só server-side (usado na indexação).
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
