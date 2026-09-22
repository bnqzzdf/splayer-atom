/** Core HTTP/WS 端口；默认 14558。 */
export const getCoreServerPort = (): number => {
  const configured = Number(process.env.ATOM_SERVER_PORT);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 65535) return configured;
  return 14558;
};
