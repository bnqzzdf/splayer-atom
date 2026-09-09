import { XMLParser } from "fast-xml-parser";
import type { UpnpRendererDescriptor } from "./discovery";
import type { UpnpMediaResource } from "./media";

const parser = new XMLParser({ removeNSPrefix: true, trimValues: true });
const SOAP_TIMEOUT_MS = 3000;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const findKey = (value: unknown, key: string): Record<string, unknown> | null => {
  if (value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const own = record[key];
  if (own != null && typeof own === "object") return own as Record<string, unknown>;
  for (const child of Object.values(record)) {
    const found = findKey(child, key);
    if (found) return found;
  }
  return null;
};

const formatUpnpTime = (positionMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const parseUpnpTime = (value: unknown): number => {
  if (typeof value !== "string") return 0;
  const match = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds + fraction) * 1000));
};

/** 构造当前媒体最小 DIDL-Lite 描述。 */
export const buildDidlLite = (resource: UpnpMediaResource): string => {
  const duration =
    resource.durationMs > 0 ? ` duration="${formatUpnpTime(resource.durationMs)}"` : "";
  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">',
    '<item id="0" parentID="-1" restricted="1">',
    `<dc:title>${escapeXml(resource.title)}</dc:title>`,
    "<upnp:class>object.item.audioItem.musicTrack</upnp:class>",
    `<res protocolInfo="http-get:*:${escapeXml(resource.mime)}:*" size="${resource.size}"${duration}>${escapeXml(resource.url)}</res>`,
    "</item></DIDL-Lite>",
  ].join("");
};

const soapAction = async (
  renderer: UpnpRendererDescriptor,
  action: string,
  args: Record<string, string | number>,
): Promise<Record<string, unknown>> => {
  const service = renderer.avTransport;
  const body = Object.entries(args)
    .map(([key, value]) => `<${key}>${escapeXml(String(value))}</${key}>`)
    .join("");
  const envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${escapeXml(service.serviceType)}">${body}</u:${action}></s:Body>` +
    "</s:Envelope>";
  const response = await fetch(service.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${service.serviceType}#${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(SOAP_TIMEOUT_MS),
  });
  const text = await response.text();
  const parsed = text ? parser.parse(text) : {};
  if (!response.ok) {
    const fault = findKey(parsed, "Fault");
    const detail = fault ? JSON.stringify(fault) : text.slice(0, 300);
    throw new Error(`UPnP ${action} failed HTTP ${response.status}: ${detail}`);
  }
  return findKey(parsed, `${action}Response`) ?? {};
};

export const setAvTransportUri = (
  renderer: UpnpRendererDescriptor,
  resource: UpnpMediaResource,
): Promise<Record<string, unknown>> =>
  soapAction(renderer, "SetAVTransportURI", {
    InstanceID: 0,
    CurrentURI: resource.url,
    CurrentURIMetaData: buildDidlLite(resource),
  });

export const playAvTransport = (
  renderer: UpnpRendererDescriptor,
): Promise<Record<string, unknown>> => soapAction(renderer, "Play", { InstanceID: 0, Speed: 1 });

export const pauseAvTransport = (
  renderer: UpnpRendererDescriptor,
): Promise<Record<string, unknown>> => soapAction(renderer, "Pause", { InstanceID: 0 });

export const stopAvTransport = (
  renderer: UpnpRendererDescriptor,
): Promise<Record<string, unknown>> => soapAction(renderer, "Stop", { InstanceID: 0 });

export const seekAvTransport = (
  renderer: UpnpRendererDescriptor,
  positionMs: number,
): Promise<Record<string, unknown>> =>
  soapAction(renderer, "Seek", {
    InstanceID: 0,
    Unit: "REL_TIME",
    Target: formatUpnpTime(positionMs),
  });

export const getTransportInfo = async (renderer: UpnpRendererDescriptor): Promise<string> => {
  const response = await soapAction(renderer, "GetTransportInfo", { InstanceID: 0 });
  return typeof response.CurrentTransportState === "string"
    ? response.CurrentTransportState
    : "UNKNOWN";
};

export const getPositionInfo = async (
  renderer: UpnpRendererDescriptor,
): Promise<{ positionMs: number; durationMs: number }> => {
  const response = await soapAction(renderer, "GetPositionInfo", { InstanceID: 0 });
  return {
    positionMs: parseUpnpTime(response.RelTime),
    durationMs: parseUpnpTime(response.TrackDuration),
  };
};
