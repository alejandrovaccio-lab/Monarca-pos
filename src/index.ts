export const MONARCA_POS_VERSION = "0.1.0";

export type HealthStatus = {
  system: "Monarca POS";
  status: "ok";
  version: string;
};

export function healthCheck(): HealthStatus {
  return {
    system: "Monarca POS",
    status: "ok",
    version: MONARCA_POS_VERSION
  };
}
