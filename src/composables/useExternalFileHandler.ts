import * as player from "@/core/player";
import { isAudioFile } from "@shared/utils/audioFile";

/**
 * 接入外部音频文件唤起与拖拽播放
 */
export const useExternalFileHandler = (): void => {
  let unsubscribe: (() => void) | null = null;

  const handleAudioFiles = async (files: string[]): Promise<void> => {
    const valid = files.filter(isAudioFile);
    if (valid.length === 0) return;
    await player.playFiles(valid);
  };

  const onDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    const dt = event.dataTransfer;
    if (!dt?.files || dt.files.length === 0) return;

    const filePaths: string[] = [];
    for (const file of Array.from(dt.files)) {
      const filePath = window.api.system.getPathForFile(file);
      if (filePath && isAudioFile(filePath)) {
        filePaths.push(filePath);
      }
    }

    if (filePaths.length > 0) {
      await handleAudioFiles(filePaths);
    }
  };

  onMounted(async () => {
    // 先注册监听再拉 pending，避免两步之间漏掉实时事件
    unsubscribe = window.api.system.onOpenFiles((files) => {
      void handleAudioFiles(files);
    });
    const pending = await window.api.system.consumePendingAudioFiles();
    if (pending.length > 0) await handleAudioFiles(pending);

    // 全局拖拽播放支持
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  });
};
