import dgram from "node:dgram";
import { XMLParser } from "fast-xml-parser";

const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_ST = "urn:schemas-upnp-org:device:MediaRenderer:1";
const DISCOVERY_WINDOW_MS = 1200;
const DESCRIPTION_TIMEOUT_MS = 2500;

export interface UpnpServiceDescriptor {
  serviceType: string;
  controlUrl: string;
  eventSubUrl?: string;
  scpdUrl?: string;
}

export interface UpnpRendererDescriptor {
  id: string;
  udn: string;
  name: string;
  location: string;
  avTransport: UpnpServiceDescriptor;
  connectionManager?: UpnpServiceDescriptor;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const findRendererDevice = (deviceValue: unknown): Record<string, unknown> | null => {
  const device = asRecord(deviceValue);
  if (!device) return null;
  const deviceType = asString(device.deviceType);
  if (deviceType?.startsWith("urn:schemas-upnp-org:device:MediaRenderer:")) return device;
  const deviceList = asRecord(device.deviceList);
  for (const child of asArray(deviceList?.device)) {
    const found = findRendererDevice(child);
    if (found) return found;
  }
  return null;
};

const resolveService = (
  serviceValue: unknown,
  baseUrl: URL,
): UpnpServiceDescriptor | null => {
  const service = asRecord(serviceValue);
  const serviceType = asString(service?.serviceType);
  const controlUrl = asString(service?.controlURL);
  if (!serviceType || !controlUrl) return null;
  return {
    serviceType,
    controlUrl: new URL(controlUrl, baseUrl).toString(),
    ...(asString(service?.eventSubURL)
      ? { eventSubUrl: new URL(asString(service?.eventSubURL)!, baseUrl).toString() }
      : {}),
    ...(asString(service?.SCPDURL)
      ? { scpdUrl: new URL(asString(service?.SCPDURL)!, baseUrl).toString() }
      : {}),
  };
};

/** 解析 MediaRenderer description，只返回 Atom 当前需要的稳定端点。 */
export const parseRendererDescription = (
  xml: string,
  location: string,
): UpnpRendererDescriptor | null => {
  const document = asRecord(parser.parse(xml));
  const root = asRecord(document?.root);
  if (!root) return null;
  const device = findRendererDevice(root.device);
  if (!device) return null;

  const udn = asString(device.UDN);
  const name = asString(device.friendlyName);
  if (!udn || !name) return null;

  const urlBase = asString(root.URLBase);
  const baseUrl = new URL(urlBase ?? location, location);
  const serviceList = asRecord(device.serviceList);
  const services = asArray(serviceList?.service)
    .map((service) => resolveService(service, baseUrl))
    .filter((service): service is UpnpServiceDescriptor => service != null);
  const avTransport = services.find((service) =>
    service.serviceType.startsWith("urn:schemas-upnp-org:service:AVTransport:"),
  );
  if (!avTransport) return null;
  const connectionManager = services.find((service) =>
    service.serviceType.startsWith("urn:schemas-upnp-org:service:ConnectionManager:"),
  );

  return {
    id: `upnp:${udn}`,
    udn,
    name,
    location,
    avTransport,
    ...(connectionManager ? { connectionManager } : {}),
  };
};

const parseSsdpLocation = (message: Buffer): string | null => {
  const text = message.toString("utf8");
  const lines = text.split(/\r?\n/);
  if (!/^HTTP\/1\.1\s+200\b/i.test(lines[0] ?? "")) return null;
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "location") continue;
    const value = line.slice(separator + 1).trim();
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
};

const searchLocations = (windowMs = DISCOVERY_WINDOW_MS): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const locations = new Set<string>();
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      if (error) reject(error);
      else resolve([...locations]);
    };

    socket.on("message", (message) => {
      const location = parseSsdpLocation(message);
      if (location) locations.add(location);
    });
    socket.once("error", finish);
    socket.bind(0, "0.0.0.0", () => {
      const request = Buffer.from(
        [
          "M-SEARCH * HTTP/1.1",
          `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          "MX: 1",
          `ST: ${SSDP_ST}`,
          "",
          "",
        ].join("\r\n"),
      );
      socket.send(request, SSDP_PORT, SSDP_HOST, (error) => {
        if (error) finish(error);
      });
      timer = setTimeout(() => finish(), Math.max(100, windowMs));
    });
  });

/** 根据 description URL 读取一个 MediaRenderer。 */
export const fetchRendererDescription = async (
  location: string,
): Promise<UpnpRendererDescriptor | null> => {
  const response = await fetch(location, { signal: AbortSignal.timeout(DESCRIPTION_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`UPnP description HTTP ${response.status}`);
  return parseRendererDescription(await response.text(), location);
};

/** 执行一次有界 SSDP 扫描，按 UDN 去重返回当前可发现的 Renderer。 */
export const scanUpnpRenderers = async (
  windowMs = DISCOVERY_WINDOW_MS,
): Promise<UpnpRendererDescriptor[]> => {
  const locations = await searchLocations(windowMs);
  const settled = await Promise.allSettled(locations.map(fetchRendererDescription));
  const byUdn = new Map<string, UpnpRendererDescriptor>();
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    byUdn.set(result.value.udn, result.value);
  }
  return [...byUdn.values()];
};
