export type DesktopEventSink = (channel: string, data?: unknown) => void;

let desktopEventSink: DesktopEventSink | null = null;

/** Desktop shell 注册自身投影事件接收器；Node Core 不注册。 */
export const configureDesktopEventSink = (sink: DesktopEventSink | null): void => {
  desktopEventSink = sink;
};

export const publishDesktopEvent = (channel: string, data?: unknown): void => {
  desktopEventSink?.(channel, data);
};
