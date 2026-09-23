/*
 * glibc < 2.38 兼容层（Diretta SDK 预编译库用）。
 *
 * 背景：Diretta SDK 150 的 ACQUA 静态库是在 glibc >= 2.38 的系统上编译的，
 * 其中两个目标文件引用了 C23 版的整数解析函数：
 *   - IPAddress.o  -> __isoc23_strtol
 *   - FileInf.o    -> __isoc23_strtoll
 * 这两个符号直到 glibc 2.38 才提供。在 Debian 11（glibc 2.31）上链接出的
 * audio-engine.node 会因 `undefined symbol: __isoc23_strtol` 而加载失败。
 *
 * 为什么可以安全转发：
 * 引用它们的只有配置/IP 解析路径，不涉及音频 DSP；这些路径解析的是
 * 点分十进制 IP 与普通十进制数值，**不会用到 C23 新增的 "0b" 二进制前缀**，
 * 因此转调到标准 strtol/strtoll 在这些调用点上语义等价。
 *
 * 为什么用 weak：
 * 在 glibc >= 2.38 的平台上本文件的函数体被条件编译剔除，不定义任何符号；
 * 万一某平台两者都在，weak 定义也会让 libc 的强符号优先，不会造成冲突。
 */
#include <features.h>
#include <stdlib.h>

#if defined(__GLIBC__) && (__GLIBC__ < 2 || (__GLIBC__ == 2 && __GLIBC_MINOR__ < 38))

__attribute__((weak)) long __isoc23_strtol(const char *nptr, char **endptr, int base) {
    return strtol(nptr, endptr, base);
}

__attribute__((weak)) long long __isoc23_strtoll(const char *nptr, char **endptr, int base) {
    return strtoll(nptr, endptr, base);
}

#endif /* glibc < 2.38 */
