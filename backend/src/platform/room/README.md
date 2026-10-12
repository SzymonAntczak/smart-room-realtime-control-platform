# Room Platform

The room platform coordinates device-independent processing, projection state,
storage session and commit/recovery, serialized input and realtime publication
for one room. `room-engine.ts` composes `room-state`, `room-storage-session`,
`room-storage-recovery`, `room-event-commit`, the input coordinator and
publication owner. The engine keeps one ordered input path and recovery cutover
and does not own source scenarios.

The runtime facade preserves the public temperature-room API. Concrete sensor
and LED definitions, cadences, scenarios, adapters and dynamic storage receipt
bridge live in `runtime/simulator/`.

Room recovery policy lives beside the read model, while live history mapping
stays in the history domain. The room engine composes these owners without
duplicating their state or defining a second input queue.
