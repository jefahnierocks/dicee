<!-- Auto-generated from AKG Graph. Edit source, not this file. -->
# Dataflow Architecture

> Auto-generated from AKG Graph
> Source: docs/architecture/akg/graph/current.json
> Commit: 2c3e875
> Generated: 2026-09-13T03:51:42.302Z

## Data Flow Diagram

Shows how data flows through the application layers:
- **Routes** → Entry points (pages)
- **Components** → UI elements
- **Stores** → Reactive state
- **Services** → Business logic
- **External** → WASM engine, Supabase

```mermaid
flowchart TB
    subgraph routes["🛣️ ROUTES"]
        module___layout__2281c5f534954443["layout"]
        module___server__9da96ec21ff80c98["+server"]
        module___page_server__89d24200f631fa99["+page.server"]
        module___page_server__e8cebee8459c656a["+page.server"]
        module___page_server__a4e25cc768dedea8["+page.server"]
    end

    subgraph components["🧩 COMPONENTS"]
        module__index__778bb80a88b12186["index"]
        module__index__95da3133dc240d1b["index"]
        module__index__b499d73339b891be["index"]
        module__index__5e4be84c5c93f936["index"]
        module__index__4f48e0fd12229a4f["index"]
    end

    subgraph stores["🗄️ STORES"]
        store__game_svelte__a023886b16c34777[("game")]
        store__profile_svelte__7d7bc841db07cdde[("profile")]
        store__lobby_svelte__906b6867cfa64be6[("lobby")]
        store__room_svelte__96cf6a00bba18489[("room")]
        store__multiplayerGame_svelte__c2ccf59ae[("multiplayerGame")]
    end

    subgraph services["⚙️ SERVICES"]
        service__breadcrumbs__e7ef58232ea69282{{"breadcrumbs"}}
        service__audio__a8f4883e9ae429c3{{"audio"}}
        store__preferences_svelte__f86dc1afcca9b{{"preferences"}}
        service__engine__b20032ebbac14fff{{"engine"}}
        store__spectatorService_svelte__6ccba423{{"spectatorService"}}
    end

    subgraph supabase["🔌 SUPABASE"]
        supabasemodule__profiles__f8ec30f5b688f0[("profiles")]
        supabasemodule__stats__f625a16b6e3db628[("stats")]
        supabasemodule__generated_types__83d90f6[("generated-types")]
        supabasemodule__client__c0dbac7ccc438ed2[("client")]
        supabasemodule__flags__0f394040bf5cce16[("flags")]
    end

    subgraph wasm["🦀 WASM"]
        wasmbridge__dicee_engine_d__86feb8f4b568(["dicee_engine.d"])
        wasmbridge__dicee_engine_bg_wasm_d__3614(["dicee_engine_bg.wasm.d"])
        wasmbridge__engine__626fe7d6a9a0c310(["engine"])
    end

    store__game_svelte__a023886b16c34777 --> service__engine__b20032ebbac14fff
    store__game_svelte__a023886b16c34777 --> service__engine__b20032ebbac14fff
    store__game_svelte__a023886b16c34777 --> service__engine__b20032ebbac14fff
    store__profile_svelte__7d7bc841db07cdde --> supabasemodule__profiles__f8ec30f5b688f0
    store__multiplayerGame_svelte__c2ccf59ae --> store__preferences_svelte__f86dc1afcca9b
    store__multiplayerGame_svelte__c2ccf59ae --> store__preferences_svelte__f86dc1afcca9b
    service__engine__b20032ebbac14fff --> wasmbridge__engine__626fe7d6a9a0c310

    %% Layer styling
    style routes fill:#e1f5fe,stroke:#0288d1
    style components fill:#f3e5f5,stroke:#7b1fa2
    style stores fill:#fff3e0,stroke:#f57c00
    style services fill:#e8f5e9,stroke:#388e3c
    style supabase fill:#fce4ec,stroke:#c2185b
    style wasm fill:#ffebee,stroke:#d32f2f
```

## Layer Summary

| Layer | Nodes | Description |
|-------|-------|-------------|
| routes | 5 | SvelteKit page routes |
| components | 5 | Reusable UI components |
| stores | 5 | Svelte reactive stores |
| services | 5 | Business logic services |
| supabase | 5 | Database & auth integration |
| wasm | 3 | Rust/WASM probability engine |

## Key Data Paths

1. **Game State Flow**: Routes → Game Components → Game Store → Engine Service → WASM
2. **Auth Flow**: Routes → Auth Components → Auth Store → Supabase
3. **Multiplayer Flow**: Components → Room Store → PartyKit Service
