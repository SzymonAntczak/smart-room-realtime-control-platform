# ADR: MQTT Source Parity Before Device Expansion

## Status

Accepted

## Context

The project has a reliable direct simulator path for development and has chosen
MQTT as the required production-like transport for device sources. Adding new
device roles before validating that boundary would create breadth without
showing whether the Dashboard, event model and command lifecycle survive real
transport differences.

The initial scope is intentionally only environmental telemetry (temperature
and humidity) and one on/off output. These roles must work through a direct
development simulator, an MQTT simulator, ESP32/ESPHome and a standalone
MQTT-capable device. Shelly is one possible example, not an architectural
dependency.

## Decision

Keep the existing direct simulator-to-adapter route exclusively for development
and deterministic domain or adapter tests. It is not a production device
transport.

Production-like device sources communicate through the local MQTT broker.
Source-specific backend adapters validate their native topics and payloads and
translate them to the shared platform contracts; sources are not required to
share a native MQTT shape.

The roadmap must not add a new device role until all four sources run
concurrently in one Dashboard. Every source has a distinct platform
`deviceId`. Source parity means equivalent platform semantics for each
capability that a source supports; it does not require every source to expose
the same device-role set. The Dashboard must expose applicable telemetry or
reported state, availability, applicable freshness, command lifecycle, recent
events and logs. A later scene must issue ordinary platform commands and must
not bypass command lifecycle or history.

Because MQTT is the required transport, loss of the backend-to-broker
connection sets `availability: offline` with reason `broker_unavailable` for
devices available only through MQTT, and blocks their commands. This means the
platform cannot reach the device through its required path; it does not claim
that every physical device was independently disconnected. Broker reconnection
alone does not restore `online`; a new trustworthy device availability signal
is required.

## Consequences

The project learns both deterministic domain behavior and realistic transport
failure behavior without forcing every test through a broker. The Dashboard can
explain a shared transport outage instead of presenting unexplained per-device
failures.

The device catalog grows more slowly. In exchange, new roles build on adapters,
observability and control semantics demonstrated across independently shaped
sources.

The platform must retain source identity in configuration, projections and
history. MQTT retained messages remain bootstrap evidence, not event history,
and MQTT delivery guarantees do not replace platform deduplication.

## Rejected Alternatives

- Replace the direct simulator route with MQTT everywhere: this would make
  domain and adapter tests slower and less deterministic.
- Add motion or ambient-light roles after the first ESP32 proof: this would
  leave the standalone MQTT adapter and concurrent Dashboard behavior unproven.
- Treat broker reconnection as automatic proof that every device is online:
  reconnect only restores the path; a device signal restores device availability.

## Verification

- Tests prove direct simulator and MQTT simulator parity at the platform
  contract boundary for supported capabilities.
- MQTT integration tests cover broker loss, reconnect, retained bootstrap,
  malformed payload and duplicate delivery.
- A manual source-parity acceptance run shows the direct simulator, MQTT
  simulator, ESP32/ESPHome and a standalone MQTT-capable device together,
  including applicable telemetry or reported state, logs, events and on/off
  command outcomes.
- No roadmap stage schedules a new device role before the source-parity gate.

## Links

- Related architecture document: [System overview](../architecture/system-overview.md)
- Related architecture document: [System context](../architecture/system-context.md)
- Related architecture document: [Reliability and testing](../architecture/reliability-and-testing.md)
- Related decision: [Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md)
- Related decision: [Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md)
