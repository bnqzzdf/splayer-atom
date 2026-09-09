import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { UpnpRendererDescriptor } from "./discovery";
import {
  registerMediaFile,
  releaseMediaResource,
  shutdownUpnpMedia,
  type UpnpMediaResource,
} from "./media";
import {
  buildDidlLite,
  getPositionInfo,
  getTransportInfo,
  parseUpnpTime,
  playAvTransport,
  seekAvTransport,
  setAvTransportUri,
} from "./transport";

test("UPnP transport emits AVTransport SOAP and parses status", async () => {
  const requests: Array<{ action: string; body: string }> = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const soapAction = String(request.headers.soapaction ?? "");
      const action = /#([^"#]+)"?$/.exec(soapAction)?.[1] ?? "Unknown";
      requests.push({ action, body });
      response.setHeader("Content-Type", "text/xml");
      if (action === "GetTransportInfo") {
        response.end(
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState></u:GetTransportInfoResponse></s:Body></s:Envelope>`,
        );
        return;
      }
      if (action === "GetPositionInfo") {
        response.end(
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><TrackDuration>0:03:04.500</TrackDuration><RelTime>0:01:02.250</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>`,
        );
        return;
      }
      response.end(
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"/></s:Body></s:Envelope>`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const renderer: UpnpRendererDescriptor = {
    id: "upnp:uuid:test",
    udn: "uuid:test",
    name: "Test Renderer",
    location: `http://127.0.0.1:${address.port}/device.xml`,
    avTransport: {
      serviceType: "urn:schemas-upnp-org:service:AVTransport:1",
      controlUrl: `http://127.0.0.1:${address.port}/avt`,
    },
  };
  const resource: UpnpMediaResource = {
    id: "resource",
    url: "http://192.168.1.10:12345/media/resource?a=1&b=2",
    filePath: "/fixture.flac",
    mime: "audio/flac",
    size: 42,
    title: "A & B <Track>",
    durationMs: 184500,
    deleteOnRelease: false,
  };

  try {
    await setAvTransportUri(renderer, resource);
    await playAvTransport(renderer);
    await seekAvTransport(renderer, 62250);
    assert.equal(await getTransportInfo(renderer), "PLAYING");
    assert.deepEqual(await getPositionInfo(renderer), {
      positionMs: 62250,
      durationMs: 184500,
    });

    const setUri = requests.find((request) => request.action === "SetAVTransportURI");
    assert.ok(setUri);
    assert.match(setUri.body, /<InstanceID>0<\/InstanceID>/);
    assert.match(setUri.body, /A &amp;amp; B &amp;lt;Track&amp;gt;/);
    assert.match(setUri.body, /a=1&amp;amp;b=2/);
    const seek = requests.find((request) => request.action === "Seek");
    assert.match(seek?.body ?? "", /<Target>0:01:02<\/Target>/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("DIDL and UPnP time helpers preserve wire escaping and milliseconds", () => {
  assert.equal(parseUpnpTime("1:02:03.250"), 3723250);
  assert.equal(parseUpnpTime("NOT_IMPLEMENTED"), 0);
  const didl = buildDidlLite({
    id: "r",
    url: "http://host/media/r?a=1&b=2",
    filePath: "/r.wav",
    mime: "audio/wav",
    size: 10,
    title: "A&B",
    durationMs: 1000,
    deleteOnRelease: false,
  });
  assert.match(didl, /<dc:title>A&amp;B<\/dc:title>/);
  assert.match(didl, /http:\/\/host\/media\/r\?a=1&amp;b=2/);
});

test("UPnP transport surfaces SOAP Faults without hiding the action", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { "Content-Type": "text/xml" });
    response.end(
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError><errorCode>701</errorCode><errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const renderer: UpnpRendererDescriptor = {
    id: "upnp:uuid:fault",
    udn: "uuid:fault",
    name: "Fault Renderer",
    location: `http://127.0.0.1:${address.port}/device.xml`,
    avTransport: {
      serviceType: "urn:schemas-upnp-org:service:AVTransport:1",
      controlUrl: `http://127.0.0.1:${address.port}/avt`,
    },
  };
  try {
    await assert.rejects(playAvTransport(renderer), /UPnP Play failed HTTP 500.*UPnPError/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("mock Renderer pulls the exact registered media bytes from SetURI", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-upnp-pull-"));
  const filePath = path.join(dir, "track.flac");
  const expected = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0, 1, 2, 3, 4, 5, 0xfe, 0xff]);
  await writeFile(filePath, expected);
  let pulled: Buffer | null = null;
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      void (async () => {
        if (String(request.headers.soapaction ?? "").includes("#SetAVTransportURI")) {
          const uri = /<CurrentURI>([^<]+)<\/CurrentURI>/.exec(body)?.[1];
          assert.ok(uri);
          pulled = Buffer.from(await (await fetch(uri)).arrayBuffer());
        }
        response.setHeader("Content-Type", "text/xml");
        response.end(
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:SetAVTransportURIResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"/></s:Body></s:Envelope>`,
        );
      })().catch((error) => response.destroy(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const renderer: UpnpRendererDescriptor = {
    id: "upnp:uuid:pull",
    udn: "uuid:pull",
    name: "Pull Renderer",
    location: `http://127.0.0.1:${address.port}/device.xml`,
    avTransport: {
      serviceType: "urn:schemas-upnp-org:service:AVTransport:1",
      controlUrl: `http://127.0.0.1:${address.port}/avt`,
    },
  };
  const resource = await registerMediaFile(filePath, {
    rendererHost: "127.0.0.1",
    title: "Pull Fixture",
    durationMs: 1000,
  });
  try {
    await setAvTransportUri(renderer, resource);
    assert.deepEqual(pulled, expected);
  } finally {
    await releaseMediaResource(resource);
    await shutdownUpnpMedia();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
