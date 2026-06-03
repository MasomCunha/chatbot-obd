import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // transformers.js (onnxruntime-node) e pdf-parse não devem ser empacotados pelo
  // bundler do servidor — são pacotes nativos/Node que correm só server-side.
  serverExternalPackages: ["@huggingface/transformers", "pdf-parse"],
};

export default nextConfig;
