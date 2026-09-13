# Dicee Telemetry & Observability Framework Report

> **Historical implementation report:** This predates the July 2026 logging
> redaction and Cloudflare authority refresh. Do not use its production-tail
> commands or identifier-based queries as current operating guidance. Start at
> [`docs/cloudflare/README.md`](docs/cloudflare/README.md) and the current logger,
> schemas, tests, and Worker configuration.

**Generated:** January 4, 2026  
**Version:** 1.0  
**Scope:** Complete analysis of current telemetry, logging, and observability infrastructure

---

## Executive Summary

Dicee implements a **comprehensive three-tier observability framework** spanning client-side telemetry, server-side structured logging, and Cloudflare Workers instrumentation. The system provides real-time insights into user behavior, system performance, and operational health with privacy-first design principles.

**Key Observability Pillars:**
- **Client-Side Telemetry:** Privacy-compliant user behavior tracking with batched delivery
- **Structured Logging:** JSON-formatted logs with component-level context and correlation IDs
- **Performance Monitoring:** Operation timing, storage metrics, and connection lifecycle tracking
- **Error Tracking:** Comprehensive error capture with stack traces and context
- **Cloudflare Integration:** Native Workers observability with real-time tail capabilities

---

## Architecture Overview

### Three-Stream Architecture (RFC-003)

The observability system follows a three-stream architecture:

1. **Telemetry Stream:** Client-side user behavior analytics (30-day retention)
2. **Logging Stream:** Server-side structured logs for operational monitoring
3. **Metrics Stream:** Performance and system health indicators

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Side   │    │  Cloudflare     │    │   Supabase      │
│                 │    │     Workers     │    │   Database      │
│ ┌─────────────┐ │    │                 │    │                 │
│ │ Telemetry   │ │───▶│ ┌─────────────┐ │───▶│ telemetry_events│
│ │ Service     │ │    │ │ API Endpoint│ │    │ (30-day rent.) │
│ └─────────────┘ │    │ └─────────────┘ │    └─────────────────┘
│                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    ┌─────────────────┐
│ │ Error       │ │    │ │ Structured  │ │───▶│ Cloudflare      │
│ │ Tracking    │ │    │ │ Logging     │ │    │ Logs (tail)     │
│ └─────────────┘ │    │ └─────────────┘ │    └─────────────────┘
└─────────────────┘    └─────────────────┘
```

---

## Client-Side Telemetry System

### Core Service Implementation

**Location:** `/packages/web/src/lib/services/telemetry.ts`

**Key Features:**
- **Privacy-First:** Opt-out consent management with localStorage persistence
- **Batched Delivery:** Events batched (10 events) and flushed every 5 seconds
- **Session Management:** Cryptographically secure session IDs with sessionStorage
- **Offline Resilience:** Event queuing with retry mechanisms
- **Performance Optimized:** Minimal impact on app performance

#### Event Types Tracked

**Session Events:**
- `session_start` - Entry page, referrer tracking
- `session_end` - Duration, page count metrics
- `page_view` - Navigation tracking with previous page context

**Game Lifecycle:**
- `game_start` - Game mode, player count, room type
- `game_complete` - Final scores, winner, duration

**User Interactions:**
- `roll` - Dice roll patterns, timing, decision making
- `category_hover` - Scorecard exploration behavior
- `category_score` - Scoring decisions and timing

**Learning Analytics:**
- `hint_requested` - Help-seeking behavior patterns
- `decision_quality` - Optimal vs. actual choices
- `prediction` - User outcome predictions

**Error Tracking:**
- `error` - Client-side errors with context and stack traces

#### Data Schema

**Event Structure:**
```typescript
interface TelemetryEvent {
  id?: string;
  session_id: string;
  user_id?: string | null;
  event_type: TelemetryEventType;
  payload: Record<string, unknown>;
  page_url?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  timestamp: string;
}
```

**Validation:** All events validated against Zod schemas before transmission

### Privacy & Compliance

**Consent Management:**
- Default opt-in with explicit opt-out capability
- Consent state persisted in localStorage
- Immediate service shutdown on opt-out
- No data collection without consent

**Data Minimization:**
- No personal identifiers collected
- Session-based tracking only
- 30-day automatic data retention
- No cross-site tracking

**Security Measures:**
- HTTPS-only transmission
- Server-side validation
- Rate limiting (50 events per request)
- SQL injection protection via parameterized queries

---

## Server-Side Logging Infrastructure

### Structured Logger System

**Location:** `/packages/cloudflare-do/src/lib/logger.ts`

**Design Philosophy:**
- **JSON-Formatted:** Machine-readable structured logs
- **Component-Based:** Logical grouping by system components
- **Context-Rich:** Automatic inclusion of relevant metadata
- **Level-Aware:** Debug, Info, Warn, Error severity levels

#### Logger Architecture

**Core Interface:**
```typescript
interface Logger {
  debug: (message: string, context?: Partial<LogContext>) => void;
  info: (message: string, context?: Partial<LogContext>) => void;
  warn: (message: string, context?: Partial<LogContext>) => void;
  error: (message: string, context?: Partial<LogContext>) => void;
  child: (context: Partial<LogContext>) => Logger;
  timed: (operation: string) => TimedLogger;
}
```

**Context Structure:**
```typescript
interface LogContext {
  component: string;        // 'GameRoom', 'GlobalLobby', etc.
  operation: string;        // 'player_join', 'chat_receive', etc.
  roomCode?: string;        // Room-specific context
  userId?: string;          // User-specific context
  requestId?: string;       // Correlation ID
  duration?: number;        // Operation timing
  [key: string]: unknown;   // Additional context
}
```

#### Pre-Configured Loggers

**Game Room Loggers:**
- `GameRoom(roomCode)` - Room-specific game operations
- `ChatManager(roomCode)` - Chat system events
- `JoinRequestRepo(roomCode)` - Room join flow tracking

**AI System Loggers:**
- `AIController(roomCode)` - AI player management
- `AIEngine()` - Core AI decision making
- `OptimalBrain()` / `AdaptiveBrain()` - AI strategy engines

**Infrastructure Loggers:**
- `GlobalLobby()` - Lobby management
- `Auth()` - Authentication flow
- `AlarmQueue()` - Scheduled task system

### Log Output Format

**JSON Structure:**
```json
{
  "level": "info",
  "message": "Player joined room",
  "timestamp": "2026-01-04T19:15:30.123Z",
  "component": "GameRoom",
  "operation": "player_join",
  "roomCode": "TEST-ROOM",
  "userId": "user-123",
  "requestId": "req-456",
  "duration": 15
}
```

**Viewing Logs:**
```bash
# Live log streaming
wrangler tail

# Filtered by component
wrangler tail | jq 'select(.component == "GameRoom")'

# Filtered by room
wrangler tail | jq 'select(.roomCode == "TEST-ROOM")'

# Error-only view
wrangler tail | jq 'select(.level == "error")'
```

---

## Cloudflare Workers Instrumentation

### Advanced Instrumentation System

**Location:** `/packages/cloudflare-do/src/lib/observability/instrumentation.ts`

**Capabilities:**
- **Type-Safe Events:** All events validated against Zod schemas
- **Auto-Correlation:** Request ID tracking across operations
- **Lifecycle Tracking:** Complete Durable Object lifecycle monitoring
- **Performance Metrics:** Operation timing and resource usage

#### Event Categories

**Lifecycle Events:**
- `lifecycle.wake` - Hibernation recovery with storage state
- `lifecycle.connect` - Client connections with role tracking
- `lifecycle.disconnect` - Connection analysis with close code categorization
- `lifecycle.reconnect` - Reconnection flow tracking

**Storage Events:**
- `storage.read.start/end` - Read operations with timing and size metrics
- `storage.write.start/end` - Write operations with success tracking
- `storage.delete` - Deletion operations
- `storage.list` - Storage enumeration with key counts

**State Machine Events:**
- `state.transition` - State changes with trigger context
- `state.transition.rejected` - Failed transitions with reasons

**Seat Management Events:**
- `seat.assign` - Player seat assignments
- `seat.reserve` - Temporary seat reservations
- `seat.reclaim.attempt/result` - Seat reclamation flow
- `seat.release` - Seat releases with reasons

**Game Events:**
- `game.start` - Game initialization with player count
- `game.turn.start/end` - Turn lifecycle tracking
- `game.roll` - Dice roll events with patterns
- `game.score` - Scoring decisions with categories
- `game.complete` - Game completion with final scores

**Connection Events:**
- `connection.auth.success/failure` - Authentication attempts
- `connection.token.expired` - Token expiration handling
- `connection.rate_limit` - Rate limiting enforcement

**Broadcast Events:**
- `broadcast.prepare` - Outgoing message preparation
- `broadcast.sent` - Message delivery confirmation

**Error Events:**
- `error.handler.failed` - Error handler failures
- `error.storage.failed` - Storage operation failures
- `error.broadcast.failed` - Message delivery failures
- `error.state.corruption` - State corruption detection

**Diagnostic Events:**
- `diagnostic.snapshot` - State snapshots for debugging
- `diagnostic.health_check` - System health assessments

#### Instrumentation Usage

**Basic Usage:**
```typescript
const instr = createInstrumentation('GameRoom', 'TEST-ROOM');

// Track client connection
instr.clientConnect('user-123', 'player', 'conn-456');

// Track game event
instr.gameRoll('user-123', 1, [1, 4, 3, 6, 2]);

// Track error
instr.errorStorageFailed('write', 'game-state', error);
```

**Timed Operations:**
```typescript
const logger = Loggers.GameRoom('TEST-ROOM');
const timer = logger.timed('ai_turn');

// ... operation ...
timer.endInfo('AI turn completed', { moves: 3, confidence: 0.85 });
```

**Correlation Tracking:**
```typescript
instr.setCorrelationId('game-session-123');
// ... related operations ...
instr.clearCorrelationId();
```

---

## Performance Monitoring

### Performance Utilities

**Location:** `/packages/cloudflare-do/src/lib/observability/performance.ts`

**Features:**
- **Operation Timing:** Automatic duration measurement
- **Async Operation Support:** Promise-based operation tracking
- **Integration Ready:** Designed for instrumentation integration

#### Performance Timer API

**Basic Timer:**
```typescript
const timer = createPerformanceTimer();

// ... operation ...
console.log(`Operation took ${timer.elapsed()}ms`);

timer.end('operation.complete', { success: true });
```

**Instrumented Timer:**
```typescript
const timer = createPerformanceTimer(instr);
await someOperation();
timer.end('operation.complete', { records: 42 });
```

**Async Measurement:**
```typescript
const result = await measureOperation(
  () => expensiveCalculation(),
  instr,
  'calculation.complete',
  { inputSize: 1000 }
);
```

### Performance Metrics Tracked

**Storage Performance:**
- Read/write operation durations
- Data transfer sizes
- Storage key enumeration performance
- Cache hit/miss ratios

**Network Performance:**
- WebSocket connection establishment
- Message delivery latency
- Broadcast operation timing
- Connection churn rates

**Game Performance:**
- Turn processing duration
- AI decision-making time
- State transition performance
- Roll animation timing

---

## Error Tracking & Diagnostics

### Comprehensive Error Capture

**Client-Side Errors:**
- JavaScript exceptions with stack traces
- Network request failures
- Game state inconsistencies
- User interface errors

**Server-Side Errors:**
- Handler execution failures
- Storage operation errors
- Authentication failures
- State corruption detection

#### Error Event Structure

**Client Error Payload:**
```typescript
interface ErrorPayload {
  message: string;
  stack?: string;
  url: string;
  line?: number;
  column?: number;
  userAgent: string;
  context?: Record<string, unknown>;
}
```

**Server Error Context:**
```typescript
// Error events include:
- Component and operation context
- Room code and user ID (when applicable)
- Request correlation ID
- Error classification and severity
- Recovery attempt status
```

### Diagnostic Capabilities

**State Snapshots:**
```typescript
instr.diagnosticSnapshot({
  playerCount: 4,
  gameState: 'playing',
  connectedSockets: 4,
  memoryUsage: '2.3MB',
  lastActivity: '2026-01-04T19:15:30Z'
});
```

**Health Checks:**
```typescript
instr.diagnosticHealthCheck(true, {
  storage: true,
  websockets: true,
  aiEngine: true,
  memory: false
});
```

---

## Cloudflare Observability Integration

### Native Cloudflare Tools

**Wrangler Tail:**
- Real-time log streaming from Workers
- JSON-formatted output for parsing
- Filterable by component, level, or custom fields
- Production and environment-specific tailing

**Usage Examples:**
```bash
# Basic tailing
wrangler tail

# Environment-specific
wrangler tail --env production

# Filtered output
wrangler tail | jq 'select(.level == "error")'
wrangler tail | jq 'select(.component == "GameRoom")'
wrangler tail | jq 'select(.roomCode | startswith("TEST"))'
```

### Cloudflare Analytics Integration

**Workers Analytics:**
- Request metrics and response times
- Error rates and status codes
- Geographic distribution
- Device and browser analytics

**Durable Objects Metrics:**
- Object creation/deletion rates
- Storage usage patterns
- Connection concurrency
- Hibernation/wake cycles

---

## Data Storage & Retention

### Supabase Telemetry Storage

**Schema:**
```sql
CREATE TABLE telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  page_url TEXT,
  referrer TEXT,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_telemetry_session_id ON telemetry_events(session_id);
CREATE INDEX idx_telemetry_user_id ON telemetry_events(user_id);
CREATE INDEX idx_telemetry_event_type ON telemetry_events(event_type);
CREATE INDEX idx_telemetry_timestamp ON telemetry_events(timestamp);

-- 30-day retention policy
CREATE OR REPLACE FUNCTION cleanup_old_telemetry()
RETURNS void AS $$
BEGIN
  DELETE FROM telemetry_events
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

**Data Access Patterns:**
```sql
-- Session analysis
SELECT event_type, COUNT(*), AVG(payload->>'duration_ms')
FROM telemetry_events
WHERE session_id = $1
GROUP BY event_type;

-- User behavior patterns
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(DISTINCT session_id) as sessions,
  COUNT(*) FILTER (WHERE event_type = 'game_start') as games_started
FROM telemetry_events
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour;

-- Error tracking
SELECT 
  event_type,
  payload->>'message' as error_message,
  COUNT(*) as occurrences
FROM telemetry_events
WHERE event_type = 'error'
  AND timestamp >= NOW() - INTERVAL '7 days'
GROUP BY event_type, error_message
ORDER BY occurrences DESC;
```

---

## Developer Tools & Workflows

### Local Development

**Telemetry Debugging:**
```typescript
// Enable debug mode
initializeTelemetry({ debug: true });

// Check current state
const state = getTelemetryState();
console.log('Telemetry state:', state);

// Force flush
await flush();
```

**Log Analysis:**
```bash
# Live development logs
wrangler tail --env dev

# Component-specific debugging
wrangler tail | jq 'select(.component == "AIController")'

# Performance analysis
wrangler tail | jq 'select(.duration) | select(.duration > 100)'
```

### Production Monitoring

**Key Metrics to Monitor:**
1. **Error Rates:** Spikes in error events
2. **Connection Churn:** Unusual disconnect patterns
3. **Game Completion:** Drop-off rates in game flow
4. **Performance:** Operation duration outliers
5. **Storage Growth:** Durable Object storage trends

**Alerting Patterns:**
```bash
# Error rate monitoring
wrangler tail | jq 'select(.level == "error")' | wc -l

# Connection monitoring
wrangler tail | jq 'select(.event == "lifecycle.disconnect")'

# Performance monitoring
wrangler tail | jq 'select(.duration and .duration > 1000)'
```

---

## Privacy & Compliance

### GDPR Compliance

**Data Minimization:**
- No personal identifiers collected
- Session-based anonymous tracking
- 30-day automatic data deletion
- User consent management

**User Rights:**
- Clear consent interface
- Easy opt-out mechanism
- Data export capabilities
- Real-time consent revocation

### Security Measures

**Data Protection:**
- HTTPS-only transmission
- Server-side validation
- SQL injection prevention
- Rate limiting and abuse protection

**Access Controls:**
- Role-based log access
- Environment isolation
- Audit trail for data access
- Secure API endpoints

---

## Extensibility & Future Enhancements

### Planned Enhancements

**Advanced Analytics:**
- Real-time dashboard integration
- Machine learning insights
- Predictive error detection
- User journey mapping

**Performance Optimization:**
- Edge analytics processing
- Reduced payload sizes
- Adaptive sampling rates
- Intelligent batching

**Integration Opportunities:**
- Third-party analytics platforms
- Alerting systems (PagerDuty, Slack)
- Business intelligence tools
- APM platforms (DataDog, New Relic)

### Custom Event Types

**Extension Pattern:**
```typescript
// Add new event type
const CUSTOM_EVENT_TYPES = {
  ...TELEMETRY_EVENT_TYPES,
  CUSTOM_METRIC: 'custom_metric',
} as const;

// Extend payload schema
export const CustomMetricPayloadSchema = z.object({
  value: z.number(),
  category: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// Track custom event
track('custom_metric', {
  value: 42,
  category: 'performance',
  metadata: { source: 'game_engine' }
});
```

---

## Conclusion

Dicee's observability framework provides **comprehensive, production-ready monitoring** across the entire application stack. The three-tier architecture ensures complete visibility into user behavior, system performance, and operational health while maintaining strong privacy protections.

**Key Strengths:**
- **Privacy-First Design:** GDPR-compliant with user consent management
- **Comprehensive Coverage:** Client telemetry, server logs, and performance metrics
- **Developer-Friendly:** Rich tooling with real-time debugging capabilities
- **Production Ready:** Scalable architecture with error handling and retry logic
- **Cloudflare Native:** Leverages Workers ecosystem for optimal performance

**Monitoring Capabilities:**
- Real-time user behavior analytics
- Complete system observability
- Performance bottleneck identification
- Error tracking and resolution
- Business intelligence insights

The framework provides developers with **deep visibility** into every aspect of the application, enabling proactive issue detection, performance optimization, and data-driven decision making. The modular design allows for easy extension and integration with additional monitoring tools as the system evolves.
