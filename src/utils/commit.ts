/**
 * 提交号在界面上的统一展示约定。
 *
 * 为什么必须固定成 8 位：产物名由 `scripts/atom/core-artifact-name.ts` 的
 * `shortCoreCommit()` 取 8 位生成
 * （`splayer-atom-core-<版本>-<短提交号>-<日期>-<时刻>-...`），源码交付包的目录名同理。
 * 界面若自行截成别的长度，用户就无法把「设置 → 关于软件 → 环境信息」里的提交号
 * 与手上的产物包文件名对齐——同一个 commit 会看起来像两个版本。
 */

/** 短提交号长度，与产物命名保持一致。 */
export const SHORT_COMMIT_LENGTH = 8;

/** 仅十六进制串算提交号；`unknown` 等占位符不参与截断。 */
const isHex = (value: string): boolean => /^[0-9a-f]+$/.test(value);

/**
 * 取短提交号用于展示。
 *
 * 展示层不做任何校验性抛错：拿不到合法提交号时原样返回，由调用方决定是否隐藏。
 *
 * @param commit 完整或任意长度的提交号
 * @returns 8 位小写短提交号；非十六进制输入原样返回
 */
export const shortCommit = (commit: string): string => {
  const value = commit.trim();
  const lower = value.toLowerCase();
  if (!isHex(lower)) return value;
  return lower.slice(0, SHORT_COMMIT_LENGTH);
};
