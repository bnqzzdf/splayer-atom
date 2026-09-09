import type { LocaleCode } from "@shared/types/settings";

/** Core 插件上下文当前使用稳定的默认语言；Control locale 不反向成为 Core authority。 */
export const getLocale = (): LocaleCode => "zh-CN";
