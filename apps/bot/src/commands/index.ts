import type { Command } from "../framework/types.js";
import { helpCommand } from "./utility/help.js";
import { pingCommand } from "./utility/ping.js";
import { privacyCommand } from "./utility/privacy.js";
import { prefixCommand } from "./admin/prefix.js";
import { welcomeCommand } from "./admin/welcome.js";
import { autoRoleCommand } from "./admin/autorole.js";
import { biasCommand } from "./social/bias.js";
import { tempVcCommand } from "./admin/tempvc.js";
import { joinToCreateCommand } from "./admin/jointocreate.js";
import { musicConfigCommand } from "./admin/musicconfig.js";
import { configCommand } from "./admin/config.js";
import { vcCommand } from "./voice/vc.js";
import { loveCalcCommand } from "./social/love.js";
import {
  choduCommand,
  hugCommand,
  kissCommand,
  optinCommand,
  optoutCommand,
  slapCommand,
  socialStatsCommand,
  socialTopCommand,
  wuzuCommand,
} from "./social/social.js";
import { musicCommands } from "./music/music.js";

export const commands: Command[] = [
  helpCommand,
  pingCommand,
  privacyCommand,
  prefixCommand,
  welcomeCommand,
  autoRoleCommand,
  tempVcCommand,
  joinToCreateCommand,
  musicConfigCommand,
  configCommand,
  vcCommand,
  loveCalcCommand,
  biasCommand,
  slapCommand,
  kissCommand,
  hugCommand,
  choduCommand,
  wuzuCommand,
  socialStatsCommand,
  socialTopCommand,
  optoutCommand,
  optinCommand,
  ...musicCommands,
];
