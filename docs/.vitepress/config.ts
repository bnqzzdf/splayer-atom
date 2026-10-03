import { defineConfig, type DefaultTheme } from "vitepress";

const repository = "https://github.com/bnqzzdf/splayer-atom";
const socialLinks: DefaultTheme.SocialLink[] = [{ icon: "github", link: repository }];

const zhTheme: DefaultTheme.Config = {
  nav: [
    { text: "首页", link: "/" },
    { text: "使用指南", link: "/guide" },
    {
      text: "部署",
      items: [
        { text: "Core 部署（systemd）", link: "/core-deployment" },
        { text: "GentooPlayer / OpenRC", link: "/gentooplayer-openrc" },
      ],
    },
    {
      text: "开发",
      items: [
        { text: "Roadmap", link: "/atom-roadmap" },
        { text: "开发环境", link: "/atom-development" },
        { text: "构建与打包", link: "/build-and-packaging" },
        { text: "Build Flavors", link: "/build-flavors" },
        { text: "CPU 变体", link: "/cpu-variants" },
        { text: "原生模块", link: "/native" },
        { text: "插件开发", link: "/plugins/" },
      ],
    },
    { text: "GitHub", link: repository },
  ],
  sidebar: [
    {
      text: "Atom",
      items: [
        { text: "概览", link: "/" },
        { text: "使用指南", link: "/guide" },
        { text: "流媒体服务", link: "/streaming" },
        { text: "插件使用", link: "/plugins-usage" },
      ],
    },
    {
      text: "部署与发布",
      items: [
        { text: "Core 部署", link: "/core-deployment" },
        { text: "GentooPlayer / OpenRC", link: "/gentooplayer-openrc" },
        { text: "构建与打包", link: "/build-and-packaging" },
        { text: "Build Flavors", link: "/build-flavors" },
        { text: "CPU 变体", link: "/cpu-variants" },
        { text: "硬件发布验收", link: "/hardware-release-checklist" },
        { text: "在线服务验收", link: "/live-provider-acceptance" },
        { text: "Diretta 排障", link: "/troubleshooting/diretta-headless-troubleshooting" },
      ],
    },
    {
      text: "开发",
      items: [
        { text: "Roadmap", link: "/atom-roadmap" },
        { text: "开发环境", link: "/atom-development" },
        { text: "原生模块", link: "/native" },
        { text: "Qobuz / TIDAL Rust", link: "/streaming-rust-guide" },
        { text: "UPnP 输出方案", link: "/upnp-output-plan" },
        { text: "贡献指南", link: "/contributing" },
        {
          text: "插件开发",
          items: [
            { text: "总览", link: "/plugins/" },
            { text: "音源插件", link: "/plugins/source" },
            { text: "控制插件", link: "/plugins/control" },
            { text: "插件更新", link: "/plugins/update" },
          ],
        },
        { text: "类型参考", link: "/types" },
      ],
    },
  ],
  outline: { level: [2, 3], label: "文章目录" },
  // 站点底部的「最后更新」由 git 提交时间自动推导（与文首手写时间戳互为补充：
  // 文首那份在 GitHub 上可见，这份在文档站里始终准确）
  lastUpdated: {
    text: "最后更新",
    formatOptions: { dateStyle: "medium" },
  },
  footer: { message: "SPlayer Atom · AGPL-3.0" },
  editLink: {
    pattern: `${repository}/blob/dev/docs/:path?plain=1`,
    text: "查看或编辑此页",
  },
};

const enTheme: DefaultTheme.Config = {
  nav: [
    { text: "Home", link: "/en/" },
    { text: "User Guide", link: "/en/guide" },
    {
      text: "Deployment",
      items: [
        { text: "Core Deployment (systemd)", link: "/en/core-deployment" },
        { text: "GentooPlayer / OpenRC", link: "/en/gentooplayer-openrc" },
      ],
    },
    {
      text: "Development",
      items: [
        { text: "Roadmap", link: "/en/atom-roadmap" },
        { text: "Build and Packaging", link: "/en/build-and-packaging" },
        { text: "Native Modules", link: "/en/native" },
        { text: "Plugin Development", link: "/en/plugins/" },
      ],
    },
    { text: "GitHub", link: repository },
  ],
  sidebar: [
    {
      text: "Atom",
      items: [
        { text: "Overview", link: "/en/" },
        { text: "User Guide", link: "/en/guide" },
        { text: "Streaming Services", link: "/en/streaming" },
        { text: "Using Plugins", link: "/en/plugins-usage" },
      ],
    },
    {
      text: "Build and Development",
      items: [
        { text: "Core Deployment", link: "/en/core-deployment" },
        { text: "GentooPlayer / OpenRC", link: "/en/gentooplayer-openrc" },
        { text: "Build and Packaging", link: "/en/build-and-packaging" },
        { text: "Native Modules", link: "/en/native" },
        { text: "Contributing", link: "/en/contributing" },
        {
          text: "Plugin Development",
          items: [
            { text: "Overview", link: "/en/plugins/" },
            { text: "Source Plugins", link: "/en/plugins/source" },
            { text: "Control Plugins", link: "/en/plugins/control" },
            { text: "Plugin Updates", link: "/en/plugins/update" },
          ],
        },
        { text: "Type Reference", link: "/en/types" },
      ],
    },
  ],
  outline: { level: [2, 3], label: "On this page" },
  lastUpdated: {
    text: "Last updated",
    formatOptions: { dateStyle: "medium" },
  },
  footer: { message: "SPlayer Atom · AGPL-3.0" },
  editLink: {
    pattern: `${repository}/blob/dev/docs/:path?plain=1`,
    text: "View or edit this page",
  },
};

export default defineConfig({
  title: "SPlayer Atom",
  head: [
    ["link", { rel: "icon", href: "/favicon.png" }],
    [
      "meta",
      {
        name: "keywords",
        content: "SPlayer Atom,Node Core,Web Control,ALSA,Diretta,UPnP,Rust,Vue",
      },
    ],
  ],
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      description: "Linux x86-64 音乐 Core 与 Web Control",
      themeConfig: zhTheme,
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      description: "Linux x86-64 music Core with Web Control",
      themeConfig: enTheme,
    },
  },
  themeConfig: {
    logo: "/favicon.png",
    siteTitle: "SPlayer Atom",
    socialLinks,
    search: { provider: "local" },
  },
});
