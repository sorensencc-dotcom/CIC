import { SchedulerRule } from "../types";

export const TorqueQueryNightlyIngestion: SchedulerRule = {
  name: "TorqueQueryNightlyIngestion",
  schedule: "0 2 * * *", // 2 AM nightly
  run: async () => {
    await fetch("http://localhost:8000/ingest", {
      method: "POST"
    });
  }
};
