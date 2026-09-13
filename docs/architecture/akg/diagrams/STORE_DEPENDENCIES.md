<!-- Auto-generated from AKG Graph. Edit source, not this file. -->
# Store Dependencies

> Auto-generated from AKG Graph
> Source: docs/architecture/akg/graph/current.json
> Commit: 2c3e875
> Generated: 2026-09-13T03:51:42.300Z

## Store Dependency Diagram

Shows how Svelte stores depend on each other.

```mermaid
flowchart LR
    store__game_svelte__a023886b16c34777[("game.svelte")]
    store__profile_svelte__7d7bc841db07cdde[("profile.svelte")]
    store__lobby_svelte__906b6867cfa64be6[("lobby.svelte")]
    store__room_svelte__96cf6a00bba18489[("room.svelte")]
    store__multiplayerGame_svelte__c2ccf59ae[("multiplayerGame.svelte")]
    store__scorecard_svelte__cde2030ea078cf4[("scorecard.svelte")]
    store__dice_svelte__eca604c8a548af90[("dice.svelte")]
    store__auth_svelte__26e9f6d5ea45fbba[("auth.svelte")]
    store__spectator_svelte__4ff8034a814520e[("spectator.svelte")]
    store__flags_svelte__e2217fa62c57cbfe[("flags.svelte")]
    store__coach_svelte__3794b05509ddd6fe[("coach.svelte")]
    store__index__7ec07d9b821cda44[("index")]
    store__chat_svelte__1b9374fbc14c8872[("chat.svelte")]
    store__audio_svelte__451dd2a40682c54c[("audio.svelte")]
    store__joinRequests_svelte__e7edb5528f8e[("joinRequests.svelte")]
    store__useKeyboardNavigation_svelte__612[("useKeyboardNavigation.svelte")]
    store__preferences_svelte__f86dc1afcca9b[("preferences.svelte")]
    store__spectatorService_svelte__6ccba423[("spectatorService.svelte")]
    store__roomService_svelte__74a05524aedb2[("roomService.svelte")]

    store__game_svelte__a023886b16c34777 --> store__dice_svelte__eca604c8a548af90
    store__game_svelte__a023886b16c34777 --> store__scorecard_svelte__cde2030ea078cf4
    store__game_svelte__a023886b16c34777 --> store__dice_svelte__eca604c8a548af90
    store__game_svelte__a023886b16c34777 --> store__scorecard_svelte__cde2030ea078cf4
    store__room_svelte__96cf6a00bba18489 --> store__roomService_svelte__74a05524aedb2
    store__room_svelte__96cf6a00bba18489 --> store__roomService_svelte__74a05524aedb2
    store__room_svelte__96cf6a00bba18489 --> store__roomService_svelte__74a05524aedb2
    store__multiplayerGame_svelte__c2ccf59ae --> store__preferences_svelte__f86dc1afcca9b
    store__multiplayerGame_svelte__c2ccf59ae --> store__roomService_svelte__74a05524aedb2
    store__multiplayerGame_svelte__c2ccf59ae --> store__preferences_svelte__f86dc1afcca9b
    store__multiplayerGame_svelte__c2ccf59ae --> store__roomService_svelte__74a05524aedb2
    store__multiplayerGame_svelte__c2ccf59ae --> store__preferences_svelte__f86dc1afcca9b
    store__multiplayerGame_svelte__c2ccf59ae --> store__roomService_svelte__74a05524aedb2
    store__spectator_svelte__4ff8034a814520e --> store__spectatorService_svelte__6ccba423
    store__spectator_svelte__4ff8034a814520e --> store__spectatorService_svelte__6ccba423
    store__spectator_svelte__4ff8034a814520e --> store__spectatorService_svelte__6ccba423
    store__chat_svelte__1b9374fbc14c8872 --> store__spectatorService_svelte__6ccba423
    store__chat_svelte__1b9374fbc14c8872 --> store__spectatorService_svelte__6ccba423
    store__chat_svelte__1b9374fbc14c8872 --> store__spectatorService_svelte__6ccba423
    store__joinRequests_svelte__e7edb5528f8e --> store__roomService_svelte__74a05524aedb2
    store__joinRequests_svelte__e7edb5528f8e --> store__roomService_svelte__74a05524aedb2
    store__joinRequests_svelte__e7edb5528f8e --> store__roomService_svelte__74a05524aedb2
```

## Store List

- **game.svelte**: `packages/web/src/lib/stores/game.svelte.ts`
- **profile.svelte**: `packages/web/src/lib/stores/profile.svelte.ts`
- **lobby.svelte**: `packages/web/src/lib/stores/lobby.svelte.ts`
- **room.svelte**: `packages/web/src/lib/stores/room.svelte.ts`
- **multiplayerGame.svelte**: `packages/web/src/lib/stores/multiplayerGame.svelte.ts`
- **scorecard.svelte**: `packages/web/src/lib/stores/scorecard.svelte.ts`
- **dice.svelte**: `packages/web/src/lib/stores/dice.svelte.ts`
- **auth.svelte**: `packages/web/src/lib/stores/auth.svelte.ts`
- **spectator.svelte**: `packages/web/src/lib/stores/spectator.svelte.ts`
- **flags.svelte**: `packages/web/src/lib/stores/flags.svelte.ts`
- **coach.svelte**: `packages/web/src/lib/stores/coach.svelte.ts`
- **index**: `packages/web/src/lib/stores/index.ts`
- **chat.svelte**: `packages/web/src/lib/stores/chat.svelte.ts`
- **audio.svelte**: `packages/web/src/lib/stores/audio.svelte.ts`
- **joinRequests.svelte**: `packages/web/src/lib/stores/joinRequests.svelte.ts`
- **useKeyboardNavigation.svelte**: `packages/web/src/lib/hooks/useKeyboardNavigation.svelte.ts`
- **preferences.svelte**: `packages/web/src/lib/services/preferences.svelte.ts`
- **spectatorService.svelte**: `packages/web/src/lib/services/spectatorService.svelte.ts`
- **roomService.svelte**: `packages/web/src/lib/services/roomService.svelte.ts`
