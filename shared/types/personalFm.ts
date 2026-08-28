/** 私人 FM 模式 */
export type PersonalFmMode = "DEFAULT" | "FAMILIAR" | "EXPLORE" | "SCENE_RCMD" | "PUZZLE_MODE_RCMD";

/** 私人 FM 场景子模式（当 mode 为 SCENE_RCMD 时） */
export type PersonalFmSubMode =
  | "EXERCISE"
  | "FOCUS"
  | "NIGHT_EMO"
  | "SLEEP_HELP"
  | "RELAX"
  | "CHEERFUL"
  | "LYRICAL"
  | "CURE"
  | "SWEET"
  | "RHYTHM_BLUES"
  | "RAINY"
  | "GAMES"
  | "RAP"
  | "K_POP"
  | "ORIGINAL_MUSICIAL"
  | "ELECTRONIC"
  | "COMMUTE"
  | "TAKE_SHOWER"
  | "COFFEE_SHOP"
  | "ROCK"
  | "INSPIRATIONAL"
  | "CHINESE"
  | "ENGLISH"
  | "YUEYU"
  | "MANYAO"
  | "JINGDIAN"
  | "LIGHT"
  | "GUOFENG"
  | "FOLK"
  | "ACG"
  | "GUDIAN"
  | "JAZZ"
  | "JAPANESE"
  | "GLOBAL"
  | "FRANCH"
  | "BLUE"
  | "DANCE"
  | "LATIN"
  | "PUNK"
  | "COUNTRY"
  | "MUSICAL"
  | "YINGSHI";

export interface PersonalFmOptions {
  mode?: PersonalFmMode;
  submode?: PersonalFmSubMode;
  limit?: number;
}
