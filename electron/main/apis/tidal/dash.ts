import { XMLParser } from "fast-xml-parser";

export interface TidalDashDescriptor {
  initializationUrl: string;
  mediaUrls: string[];
  codec?: string;
  sampleRate?: number;
}

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
});

const isRecord = (value: unknown): value is XmlRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const asPositiveInteger = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`TIDAL DASH 数值无效: ${String(value)}`);
  return parsed;
};

const findRepresentations = (value: unknown, output: XmlRecord[] = []): XmlRecord[] => {
  if (Array.isArray(value)) {
    for (const item of value) findRepresentations(item, output);
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === "Representation") {
      for (const representation of asArray(child)) {
        if (isRecord(representation)) output.push(representation);
      }
      continue;
    }
    findRepresentations(child, output);
  }
  return output;
};

const replaceRepresentationId = (template: string, representationId: string | undefined): string => {
  if (!template.includes("$RepresentationID$")) return template;
  if (!representationId) throw new Error("TIDAL DASH 缺少 Representation ID");
  return template.replaceAll("$RepresentationID$", representationId);
};

const replaceSegmentNumber = (template: string, number: number): string => {
  if (template.includes("$Time$")) throw new Error("TIDAL DASH 暂不支持 $Time$ SegmentTemplate");
  let replaced = false;
  const result = template.replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, width: string | undefined) => {
    replaced = true;
    return width ? String(number).padStart(Number(width), "0") : String(number);
  });
  if (!replaced) throw new Error("TIDAL DASH media 模板缺少 $Number$");
  return result;
};

const requireHttpUrl = (value: string, field: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`TIDAL DASH ${field} 不是绝对 URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`TIDAL DASH ${field} 协议不支持: ${url.protocol}`);
  }
  return url.toString();
};

const parseRepresentation = (representation: XmlRecord): TidalDashDescriptor | null => {
  const templateValue = representation.SegmentTemplate;
  const template = asArray(templateValue).find(isRecord);
  if (!template) return null;

  const rawInitialization = typeof template.initialization === "string" ? template.initialization : "";
  const rawMedia = typeof template.media === "string" ? template.media : "";
  if (!rawInitialization || !rawMedia) return null;

  const representationId =
    typeof representation.id === "string" || typeof representation.id === "number"
      ? String(representation.id)
      : undefined;
  const initialization = requireHttpUrl(
    replaceRepresentationId(rawInitialization, representationId),
    "initialization",
  );
  const mediaTemplate = replaceRepresentationId(rawMedia, representationId);
  const startNumber = asPositiveInteger(template.startNumber, 1);

  const timeline = isRecord(template.SegmentTimeline) ? template.SegmentTimeline : null;
  const segments = timeline ? asArray(timeline.S).filter(isRecord) : [];
  if (segments.length === 0) throw new Error("TIDAL DASH 缺少 SegmentTimeline");

  let count = 0;
  for (const segment of segments) {
    const repeat = asPositiveInteger(segment.r, 0);
    count += repeat + 1;
    if (count > 10_000) throw new Error("TIDAL DASH 分段数量异常");
  }

  const mediaUrls = Array.from({ length: count }, (_unused, index) =>
    requireHttpUrl(replaceSegmentNumber(mediaTemplate, startNumber + index), "media"),
  );
  const sampleRate = Number(representation.audioSamplingRate);
  return {
    initializationUrl: initialization,
    mediaUrls,
    codec: typeof representation.codecs === "string" ? representation.codecs : undefined,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
  };
};

/**
 * 解析当前 TIDAL Hi-Res MPEG-DASH MPD。
 * 只接受带 SegmentTemplate + SegmentTimeline + Number 模板的当前已验证结构；
 * 不猜测未知 DASH 变体。
 * @param xml - base64 解码后的 MPD XML
 * @returns initialization 与有序 media segment URL
 */
export const parseTidalDashManifest = (xml: string): TidalDashDescriptor => {
  if (!xml.includes("<MPD")) throw new Error("TIDAL DASH manifest 不是 MPD XML");
  const document = parser.parse(xml) as unknown;
  const representations = findRepresentations(document);
  for (const representation of representations) {
    const parsed = parseRepresentation(representation);
    if (parsed) return parsed;
  }
  throw new Error("TIDAL DASH 未找到可用的 audio Representation/SegmentTemplate");
};
