import type { Component } from "vue";

/**
 * Control 业务动作的共享描述。
 *
 * presentation（右键、长按、`...`）只消费这份语义，不重复判断业务可见性。
 */
export interface ControlAction {
  /** 稳定动作 ID。 */
  id: string;
  /** 当前 locale 下的展示文本。 */
  label: string;
  /** 可选展示图标。 */
  icon?: Component;
  /** 当前上下文是否允许执行。 */
  enabled: boolean;
  /** 当前业务上下文是否展示。 */
  visible: boolean;
  /** 是否为破坏性动作。 */
  danger: boolean;
  /** 动作最终委托的 Core command；纯 Control/Host 动作可省略。 */
  coreCommand?: string;
  /** presentation 可在此动作前显示分组分隔。 */
  separator?: boolean;
  /** 子动作共享相同模型。 */
  children?: ControlAction[];
}

/** 构建动作时补齐统一的默认语义。 */
export const createControlAction = (
  action: Omit<ControlAction, "enabled" | "visible" | "danger"> &
    Partial<Pick<ControlAction, "enabled" | "visible" | "danger">>,
): ControlAction => ({ enabled: true, visible: true, danger: false, ...action });

/** 统一判断动作是否应出现在当前 Control。 */
export const isControlActionVisible = (action: ControlAction): boolean => action.visible;
