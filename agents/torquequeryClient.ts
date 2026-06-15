import { TorqueQueryClient } from "../torquequery-sdk/client";

export const tq = new TorqueQueryClient("http://localhost:8000");

export const TorqueQueryLocal = {
  name: "TorqueQueryLocal",
  description: "Local documentation resolver",
  run: async ({ question, taskLabels }: { question: string; taskLabels: string[] }) => {
    return await tq.resolveDocs(question, taskLabels);
  }
};
