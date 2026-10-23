import type { Command } from "../framework/types.js";
import { helpCommand } from "./utility/help.js";
import { pingCommand } from "./utility/ping.js";
import { economyCommand } from "./utility/economy.js";
import { stocksCommand } from "./utility/stocks.js";
import { privacyCommand } from "./utility/privacy.js";
import { prefixCommand } from "./admin/prefix.js";
import { welcomeCommand } from "./admin/welcome.js";
import { autoRoleCommand } from "./admin/autorole.js";
import { birthdayCommand } from "./utility/birthday.js";
import { activityCommand, activityTopCommand } from "./utility/activity.js";
import { levelCommand, levelChannelCommand } from "./utility/leveling.js";
import { testCommand } from "./utility/test.js";
import { ttsCommand } from "./utility/tts.js";
import { biasCommand } from "./social/bias.js";
import {
  adoptCommand,
  divorceCommand,
  familyTreeCommand,
  marryCommand,
  runawayCommand,
} from "./social/family.js";
import { deluluCommand } from "./social/delulu.js";
import { confessCommand } from "./social/confess.js";
import { friendshipCommand, friendshipTopCommand } from "./social/friendship.js";
import { tempVcCommand } from "./admin/tempvc.js";
import { confessionCommand } from "./admin/confession.js";
import { joinToCreateCommand } from "./admin/jointocreate.js";
import { musicConfigCommand } from "./admin/musicconfig.js";
import { configCommand } from "./admin/config.js";
import { vcCommand } from "./voice/vc.js";
import { loveCalcCommand } from "./social/love.js";
import { tambolaCommand } from "./social/tambola.js";
import { relicsCommand } from "./social/relics.js";
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
  economyCommand,
  stocksCommand,
  birthdayCommand,
  activityCommand,
  activityTopCommand,
  levelCommand,
  levelChannelCommand,
  testCommand,
  ttsCommand,
  prefixCommand,
  welcomeCommand,
  autoRoleCommand,
  tempVcCommand,
  confessionCommand,
  joinToCreateCommand,
  musicConfigCommand,
  configCommand,
  vcCommand,
  loveCalcCommand,
  tambolaCommand,
  relicsCommand,
  biasCommand,
  adoptCommand,
  divorceCommand,
  familyTreeCommand,
  marryCommand,
  runawayCommand,
  deluluCommand,
  confessCommand,
  friendshipCommand,
  friendshipTopCommand,
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
