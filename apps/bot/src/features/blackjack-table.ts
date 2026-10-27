import { createCanvas } from "@napi-rs/canvas";
import { canvasFonts } from "./canvas.js";

export interface BlackjackTableState {
  player: string[]; dealer: string[]; bet: number; status: "playing" | "finished";
  result?: string; payout?: number;
}

export function blackjackHandTotal(cards: string[]): number {
  let aces = 0;
  let total = cards.reduce((sum, card) => {
    const rank = card.slice(0, -1);
    if (rank === "A") { aces++; return sum + 11; }
    return sum + (["K", "Q", "J"].includes(rank) ? 10 : Number(rank));
  }, 0);
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

/** All card art is local. The hidden card's rank, suit and value are never painted. */
export function renderBlackjackTable(game: BlackjackTableState): Buffer {
  const canvas = createCanvas(1040, 840), ctx = canvas.getContext("2d"), fonts = canvasFonts();
  const background = ctx.createLinearGradient(0, 0, 1040, 840);
  background.addColorStop(0, "#143c39"); background.addColorStop(1, "#102523");
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1040, 840);
  ctx.strokeStyle = "#42635a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(22, 22, 996, 796, 32); ctx.stroke();
  const label = (value: string, x: number, y: number, size: number, color: string, bold = false) => {
    ctx.font = `${size}px ${bold ? fonts.bold : fonts.regular}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  label("SIELA  /  THE CARD ROOM", 52, 65, 16, "#aac8bd", true);
  label("Blackjack", 52, 119, 42, "#fff8e9", true);
  ctx.textAlign = "right";
  label(`${game.bet.toLocaleString("en-US")} SC`, 986, 86, 27, "#e8ce90", true);
  label("ON THE TABLE", 986, 111, 12, "#aac8bd"); ctx.textAlign = "left";
  const drawHand = (cards: string[], y: number, hidden: boolean) => {
    const step = Math.min(138, 824 / Math.max(1, cards.length - 1));
    cards.forEach((value, index) => {
      const x = 56 + step * index, back = hidden && index > 0;
      ctx.fillStyle = "#00000030"; ctx.beginPath(); ctx.roundRect(x + 3, y + 5, 112, 158, 12); ctx.fill();
      ctx.fillStyle = back ? "#334b65" : "#fffaf0";
      ctx.beginPath(); ctx.roundRect(x, y, 112, 158, 12); ctx.fill();
      if (back) {
        ctx.save(); ctx.beginPath(); ctx.roundRect(x + 7, y + 7, 98, 144, 7); ctx.clip();
        ctx.strokeStyle = "#adc1d04d"; ctx.lineWidth = 1;
        for (let i = -160; i < 260; i += 14) {
          ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + 158, y + 158); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + i, y + 158); ctx.lineTo(x + i + 158, y); ctx.stroke();
        }
        ctx.restore(); ctx.textAlign = "center"; label("S", x + 56, y + 93, 38, "#fff5db", true); ctx.textAlign = "left";
        return;
      }
      const rank = value.slice(0, -1), suit = value.slice(-1), red = suit === "♥" || suit === "♦";
      const ink = red ? "#b83450" : "#203137";
      label(rank, x + 12, y + 31, 25, ink, true); label(suit, x + 12, y + 54, 20, ink);
      ctx.textAlign = "center"; label(suit, x + 56, y + 104, 58, ink); ctx.textAlign = "left";
      ctx.save(); ctx.translate(x + 112, y + 158); ctx.rotate(Math.PI);
      label(rank, 12, 31, 25, ink, true); label(suit, 12, 54, 20, ink); ctx.restore();
    });
  };
  const finished = game.status === "finished";
  label("DEALER", 56, 173, 16, "#aac8bd", true);
  ctx.textAlign = "right";
  label(finished ? `${blackjackHandTotal(game.dealer)} POINTS` : `${blackjackHandTotal(game.dealer.slice(0, 1))} SHOWING`, 982, 173, 18, "#e5eadd", true);
  ctx.textAlign = "left"; drawHand(game.dealer, 195, !finished);
  ctx.strokeStyle = "#71918840"; ctx.beginPath(); ctx.moveTo(56, 399); ctx.lineTo(984, 399); ctx.stroke();
  label("YOUR HAND", 56, 448, 16, "#aac8bd", true);
  ctx.textAlign = "right"; label(`${blackjackHandTotal(game.player)} POINTS`, 982, 448, 22, "#e8ce90", true);
  ctx.textAlign = "left"; drawHand(game.player, 470, false);
  ctx.fillStyle = "#091d1b"; ctx.beginPath(); ctx.roundRect(48, 690, 944, 100, 16); ctx.fill();
  label(finished ? game.result ?? "Hand complete" : "Your move.", 72, 731, 26, "#fff8e9", true);
  label(finished ? `Payout · ${(game.payout ?? 0).toLocaleString("en-US")} SC` : "Take another card, or stand with your hand.", 72, 762, 18, "#aac8bd");
  return canvas.toBuffer("image/png");
}
