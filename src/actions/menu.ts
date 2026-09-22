import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { isControlActionVisible, type ControlAction } from "./model";

/** 将共享动作语义投影成现有 Vue 菜单 presentation。 */
export const controlActionToMenuItem = (action: ControlAction): DropdownMenuItem => ({
  key: action.id,
  label: action.label,
  icon: action.icon,
  disabled: !action.enabled,
  show: isControlActionVisible(action),
  separator: action.separator,
  children: action.children?.map(controlActionToMenuItem),
});

/** 将一组共享动作投影为菜单项。 */
export const controlActionsToMenuItems = (actions: ControlAction[]): DropdownMenuItem[] =>
  actions.map(controlActionToMenuItem);
