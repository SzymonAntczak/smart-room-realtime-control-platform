# ADR: Versioned Room Realtime Synchronization

## Status

Superseded by [ADR: Room Realtime Synchronization](adr-room-realtime-synchronization.md).

## Context

The earlier realtime slice introduced separate snapshot shapes and a client
compatibility path while the protocol was changing rapidly.

## Former Decision

The BFF emitted the newer snapshot shape, while clients also accepted the older
shape and discarded its event-history fields before rendering.

## Why It Was Superseded

The repository remains in deep local development and its producers and
consumers are updated together. Supporting multiple shapes concealed contract
drift and added validation and test complexity without serving an independently
deployed user. The current ADR therefore defines one strict contract and defers
production versioning to a dedicated production-readiness decision.
