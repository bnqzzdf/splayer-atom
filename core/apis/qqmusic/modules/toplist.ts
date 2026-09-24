/**
 * 排行榜目录（榜单分类 + 全部榜单）
 *
 * module: musicToplist.ToplistInfoServer / GetAll
 *
 * 返回结构：data.group[] → 每个分组下挂 toplist[]。
 * 实测分组：巅峰榜(0) / 特色榜(2) / 地区榜(1) / 全球榜(3) / 网络榜(4)，共 46 个榜单。
 *
 * 每个榜单条目自带一张头图（headPicUrl 等，T003R500x500），可直接作为卡片封面，
 * 因此这里不需要再逐榜调用详情接口。
 *
 * params: 无
 */

import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface RawToplist {
  topId?: number;
  title?: string;
  titleDetail?: string;
  intro?: string;
  updateTime?: string;
  totalNum?: number;
  listenNum?: number;
  headPicUrl?: string;
  frontPicUrl?: string;
  mbFrontPicUrl?: string;
  mbHeadPicUrl?: string;
  pic?: string;
  song?: Array<{ cover?: string }>;
}

interface RawGroup {
  groupId?: number;
  groupName?: string;
  toplist?: RawToplist[];
}

const toplist: QMModule = async () => {
  const data = await qmRequest<{ group?: RawGroup[] }>(
    "musicToplist.ToplistInfoServer",
    "GetAll",
    {},
  );

  const groups = (data?.group ?? [])
    .map((group) => {
      const items = (group.toplist ?? [])
        .map((item) => {
          const id = item.topId != null ? String(item.topId) : "";
          const name = item.title ?? "";
          if (!id || !name) return null;
          // 头图优先级：headPicUrl → mbHeadPicUrl → frontPicUrl → mbFrontPicUrl → 榜首专辑封面
          const cover =
            item.headPicUrl ||
            item.mbHeadPicUrl ||
            item.frontPicUrl ||
            item.mbFrontPicUrl ||
            item.pic ||
            item.song?.[0]?.cover ||
            "";
          return {
            id,
            name,
            // 接口下发的是 http，统一升级为 https，避免在 https 页面里被当成混合内容拦掉
            cover: cover.replace(/^http:\/\//, "https://"),
            total: item.totalNum ?? 0,
            playCount: item.listenNum ?? 0,
            updateTime: item.updateTime ?? "",
            description: item.intro ?? "",
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return {
        id: group.groupId != null ? String(group.groupId) : "",
        name: group.groupName ?? "",
        items,
      };
    })
    .filter((group) => group.items.length > 0);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return { code: 200, total, groups };
};

export default toplist;
