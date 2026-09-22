import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./useCopyText";

const setSecureContext = (value: boolean): void => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
};

const setClipboard = (writeText: (text: string) => Promise<void>): void => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

const setExecCommand = (copy: () => boolean): void => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: copy,
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, "isSecureContext");
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  document.body.replaceChildren();
});

describe("writeClipboardText", () => {
  it("uses the Clipboard API in a secure context", async () => {
    const writeText = vi.fn(async () => undefined);
    const execCommand = vi.fn(() => true);
    setSecureContext(true);
    setClipboard(writeText);
    setExecCommand(execCommand);

    await writeClipboardText("SPlayer Atom");

    expect(writeText).toHaveBeenCalledWith("SPlayer Atom");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("uses a temporary selection for LAN HTTP", async () => {
    setSecureContext(false);
    const setData = vi.fn();
    const execCommand = vi.fn(() => {
      const textarea = document.querySelector("textarea");
      expect(textarea?.value).toBe("局域网复制");
      expect(textarea?.selectionStart).toBe(0);
      expect(textarea?.selectionEnd).toBe("局域网复制".length);
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { setData },
      });
      document.dispatchEvent(event);
      return true;
    });
    setExecCommand(execCommand);

    await writeClipboardText("局域网复制");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setData).toHaveBeenCalledWith("text/plain", "局域网复制");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
