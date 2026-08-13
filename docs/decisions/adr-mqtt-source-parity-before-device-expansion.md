# ADR: MQTT Source Parity Before Device Expansion

## Status

Accepted

## Context

The project has chosen MQTT as the required transport for simulator and device
runtime traffic once MQTT is introduced. Keeping a second direct simulator
runtime for ordinary development would make the fastest feedback loop less
representative of the target system and could hide transport-specific failure
modes until late in delivery.

The initial scope is intentionally only environmental telemetry (temperature
and humidity) and one on/off output. These roles must work through an MQTT
simulator, ESP32/ESPHome and a standalone MQTT-capable device. Shelly is one
possible example, not an architectural dependency.

## Decision

After MQTT is introduced, use the MQTT simulator as the normal local
development and end-to-end runtime. User commands travel from the BFF through
an MQTT adapter and broker to the simulator; simulator observations and state
reports return through the broker and adapter before they affect projections.

Development scenario controls remain a backend-owned, development-only control
boundary. They may invoke simulator scenario behavior without MQTT because
they are test tooling, not a device protocol. Every observable result of a
scenario, including telemetry, availability and reported state, must still
travel from the simulator through MQTT before it affects the platform.

Direct adapter or simulator calls may be used only as isolated test seams for
domain logic and adapter translation. They must not form an alternate local
application runtime, Dashboard source or end-to-end test route.

Source-specific backend adapters validate their native topics and payloads and
translate them to the shared platform contracts; sources are not required to
share a native MQTT shape.

The roadmap must not add a new device role until all three runtime sources run
concurrently in one Dashboard. Every source has a distinct platform
`deviceId`. Source parity means equivalent platform semantics for each
capability that a source supports; it does not require every source to expose
the same device-role set. The Dashboard must expose applicable telemetry or
reported state, availability, applicable freshness, command lifecycle, recent
events and logs. A later scene must issue ordinary platform commands and must
not bypass command lifecycle or history.

The source-aware logs in that later Dashboard are an operational view. They do
not turn Stage 4 quarantine diagnostics into recent-event product history;
ignored input remains available through its technical diagnostics contract and
correlated logs unless a later accepted decision explicitly changes that
boundary.

Because MQTT is the required transport, loss of the backend-to-broker
connection sets `availability: offline` with reason `broker_unavailable` for
devices available only through MQTT, and blocks their commands. This means the
platform cannot reach the device through its required path; it does not claim
that every physical device was independently disconnected. Broker reconnection
alone does not restore `online`; a new trustworthy device availability signal
is required.

## Consequences

The local feedback loop exercises the production-like transport boundary from
the moment it is introduced. The Dashboard can explain a shared transport
outage instead of presenting unexplained per-device failures. Isolated tests
remain fast because they test domain and adapter logic at explicit seams rather
than by maintaining a second runtime topology.

The device catalog grows more slowly. In exchange, new roles build on adapters,
observability and control semantics demonstrated across independently shaped
sources.

The platform must retain source identity in configuration, projections and
history. MQTT retained messages remain bootstrap evidence, not event history,
and MQTT delivery guarantees do not replace platform deduplication.

## Rejected Alternatives

- Keep a direct simulator runtime for ordinary development: this would make
  the default feedback loop less representative and defer MQTT failures.
- Add motion or ambient-light roles after the first ESP32 proof: this would
  leave the standalone MQTT adapter and concurrent Dashboard behavior unproven.
- Treat broker reconnection as automatic proof that every device is online:
  reconnect only restores the path; a device signal restores device availability.

## Verification

- Unit tests cover platform-domain rules and adapter translation through
  explicit direct test seams.
- MQTT integration tests cover broker loss, reconnect, retained bootstrap,
  malformed payload and duplicate delivery.
- A manual source-parity acceptance run shows the MQTT simulator,
  ESP32/ESPHome and a standalone MQTT-capable device together,
  including applicable telemetry or reported state, logs, events and on/off
  command outcomes.
- No roadmap stage schedules a new device role before the source-parity gate.

## Links

- Related architecture document: [System overview](../architecture/system-overview.md)
- Related architecture document: [System context](../architecture/system-context.md)
- Related architecture document: [Reliability and testing](../architecture/reliability-and-testing.md)
- Related decision: [Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md)
- Related decision: [Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md)
