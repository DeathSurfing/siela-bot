import type { Command } from "../framework/types.js";
import { helpCommand } from "./utility/help.js";
import { pingCommand } from "./utility/ping.js";
import { privacyCommand } from "./utility/privacy.js";
import { translateCommand } from "./utility/translate.js";
import { prefixCommand } from "./admin/prefix.js";
import { welcomeCommand } from "./admin/welcome.js";
import { autoRoleCommand } from "./admin/autorole.js";
import { tempVcCommand } from "./admin/tempvc.js";
import { musicConfigCommand } from "./admin/musicconfig.js";
import { configCommand } from "./admin/config.js";
import { vcCommand } from "./voice/vc.js";
import {
  choduCommand,
  hugCommand,
  kissCommand,
  optinCommand,
  optoutCommand,
  slapCommand,
  socialStatsCommand,
  socialTopCommand,
} from "./social/social.js";
import { musicCommands } from "./music/music.js";

export const commands: Command[] = [
  helpCommand,
  pingCommand,
  privacyCommand,
  translateCommand,
  prefixCommand,
  welcomeCommand,
  autoRoleCommand,
  tempVcCommand,
  musicConfigCommand,
  configCommand,
  vcCommand,
  slapCommand,
  kissCommand,
  hugCommand,
  choduCommand,
  socialStatsCommand,
  socialTopCommand,
  optoutCommand,
  optinCommand,
  ...musicCommands,
];
