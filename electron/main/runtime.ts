import { isHeadless } from "./core/mode";

export type AtomRuntimeMode = "desktop" | "headless";

/** Runtime mode delegates to the single Core mode decision. */
export const getRuntimeMode = (): AtomRuntimeMode => (isHeadless() ? "headless" : "desktop");

export const isHeadlessMode = isHeadless;

/** External control is always reachable on LAN in headless mode. */
export const getHeadlessServerPort = (): number => {
  const configured = Number(process.env.ATOM_SERVER_PORT);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 65535) return configured;
  return process.env.ELECTRON_RENDERER_URL ? 14559 : 14558;
};
