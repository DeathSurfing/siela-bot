# Discord message design

Siela uses native Discord Components V2 for cards and interactive panels. The shared helpers in `apps/bot/src/features/ui.ts` provide feature colors, a compact brand line, heading/subtitle grouping, dividers, optional metric fields, actions, and a quiet footer. Existing component custom IDs and command behavior are retained.

- Social and Delulu use rose; music uses teal; economy uses gold; games use periwinkle; voice uses blue; administration uses sage.
- Delulu adds locally rendered PNG artwork, a narrative section, a separate dialogue block when available, and a cost/use footer. All story text remains readable native text. Artwork makes no requests to external image services.
- Wallets highlight the available balance and daily streak.
- Music retains native artwork thumbnails when available, playback progress, volume/loop/queue information, and existing controls.
- Help groups the main activities before its category and search controls.
- Dense Tambola tickets combine their brand and title in one component to preserve Discord's component budget.
- All command replies and background notices pass through the shared native-card presentation, including errors, cooldowns, confirmations, welcomes, birthdays, and private messages. Controls, attachments, explicit mention policy, and private delivery are retained. Confirmation dialogs have a distinct warning theme.

## Offline preview

From the repository root:

```powershell
bun apps/bot/src/scripts/preview-ui.ts C:/path/to/preview-output
```

This generates six sample message payloads, a PNG attachment, and a Discord-style HTML review sheet. It posts nothing to Discord. The HTML is an approximation; the deployed implementation uses Discord's native rendering. `payloads.json` contains the actual serialized components.

Watchtower deployment policy is independent of these visual changes. Local monitor-only settings remain unchanged.
