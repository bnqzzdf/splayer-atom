import assert from "node:assert/strict";
import test from "node:test";
import { parseRendererDescription } from "./discovery";

test("parseRendererDescription resolves MediaRenderer service URLs", () => {
  const descriptor = parseRendererDescription(
    `<?xml version="1.0"?>
      <root xmlns="urn:schemas-upnp-org:device-1-0">
        <URLBase>http://192.168.1.50:1400/base/</URLBase>
        <device>
          <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
          <friendlyName>Living Room</friendlyName>
          <UDN>uuid:renderer-1</UDN>
          <serviceList>
            <service>
              <serviceType>urn:schemas-upnp-org:service:AVTransport:3</serviceType>
              <SCPDURL>avt.xml</SCPDURL>
              <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
              <eventSubURL>/MediaRenderer/AVTransport/Event</eventSubURL>
            </service>
            <service>
              <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
              <controlURL>connection/control</controlURL>
            </service>
          </serviceList>
        </device>
      </root>`,
    "http://192.168.1.50:1400/xml/device_description.xml",
  );

  assert.ok(descriptor);
  assert.equal(descriptor.id, "upnp:uuid:renderer-1");
  assert.equal(descriptor.name, "Living Room");
  assert.equal(descriptor.avTransport.serviceType, "urn:schemas-upnp-org:service:AVTransport:3");
  assert.equal(
    descriptor.avTransport.controlUrl,
    "http://192.168.1.50:1400/MediaRenderer/AVTransport/Control",
  );
  assert.equal(descriptor.avTransport.scpdUrl, "http://192.168.1.50:1400/base/avt.xml");
  assert.equal(
    descriptor.connectionManager?.controlUrl,
    "http://192.168.1.50:1400/base/connection/control",
  );
});

test("parseRendererDescription finds embedded renderer and rejects non-renderer descriptions", () => {
  const embedded = parseRendererDescription(
    `<root><device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
      <deviceList><device>
        <deviceType>urn:schemas-upnp-org:device:MediaRenderer:2</deviceType>
        <friendlyName>Embedded Renderer</friendlyName><UDN>uuid:embedded</UDN>
        <serviceList><service>
          <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
          <controlURL>/avt</controlURL>
        </service></serviceList>
      </device></deviceList></device></root>`,
    "http://10.0.0.20/device.xml",
  );
  assert.equal(embedded?.id, "upnp:uuid:embedded");

  assert.equal(
    parseRendererDescription(
      `<root><device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType></device></root>`,
      "http://10.0.0.21/device.xml",
    ),
    null,
  );
});
