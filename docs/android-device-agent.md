# Android Device Agent

## Overview

A dedicated Android app that connects to the server and exposes device-only capabilities via a secure command channel. This allows controlling the phone remotely from desktop sessions or even allowing other users (like a spouse) to control the device from their own sessions.

**Core Concept**: Server = brain (AI runtime, policy, jobs), Android Agent = hands (native capabilities). No UI duplication needed—the agent is purely a capability provider that listens for commands and executes them.

## Architecture

```
Desktop/Web Session → Server (AI + Policy) → WebSocket → Android Agent → Device APIs
```

- **Server**: Hosts AI runtime, policies, job orchestration, audit logs
- **Android Agent**: Lightweight app that connects when launched, registers capabilities, executes commands
- **Transport**: Persistent WebSocket with JSON-RPC protocol
- **Security**: QR pairing, signed messages, explicit confirmations for sensitive actions

## Capabilities (Start Minimal, Expand)

### Core Features

- Notifications, toasts, foreground service control
- Location/geofencing
- Secure storage (Android Keystore)
- Intent launch (open apps, URLs, deep links)
- Clipboard access
- Media capture, file pick/save

### Advanced Features (Optional)

- **Accessibility Service**: Query/act on other app UIs, gestures, screen automation
- **BLE/NFC**: Device connectivity and interaction
- **Telephony/SMS**: With explicit confirmations and rate limiting
- **Boot receiver**: Auto-reconnect on device start (user-controlled)

## Protocol Design

### Transport

- **WebSocket**: Single persistent duplex channel
- **Format**: JSON-RPC 2.0 or custom envelope
- **Reliability**: Heartbeat, auto-reconnect with backoff, idempotent operations

### Message Types

```typescript
// Device registers its capabilities on connect
capabilities.register {
  deviceId, userId,
  manifest: [{ name, version, inputSchema, policyTags, permissions, availability }]
}

// Server invokes a tool on the device
tool.invoke {
  callId, name, params, timeoutMs, policyContext
}

// Device streams progress/events during execution
tool.event {
  callId, event: "progress|prompt|log|partial", data
}

// Device returns final result
tool.result {
  callId, ok, value? | error?
}

// Device emits ambient events (geofence, notifications, etc.)
device.event {
  name: "geofenceEntered|notificationReceived|batteryLow", data
}
```

## Security Model

### Pairing Process

1. Web session displays QR code with one-time pairing token
2. Android agent scans QR, exchanges token for signed credentials
3. Subsequent authentication via JWT or JWS per message
4. Each device gets unique keypair for signing

### Policy Enforcement

- **Server-side**: Allowlist tools per device/user, rate limits, audit logs
- **Device-side**: Permission gating, user confirmations for sensitive actions
- **Risk Tags**: Tools tagged as risky require explicit on-device confirmation

### Data Handling

- Process sensitive data on-device by default
- Never exfiltrate raw accessibility node trees or screenshots without consent
- Encrypt at rest (Android Keystore) and in transit (TLS + signed messages)

## Android Agent Implementation

### Core Components

- **Connection Manager**: WebSocket with resilient reconnection
- **Tool Registry**: Maps tool names to handler functions
- **Permission Broker**: Manages Android permissions, surfaces status
- **Confirmation UI**: Modal dialogs for sensitive action approval
- **Foreground Service**: Keeps agent alive during active sessions

### Technology Options

- **Pure Native (Kotlin)**: Smallest footprint, best Accessibility Service control
- **Expo Thin Shell**: Faster development, React Native ecosystem access

### Required Permissions

```xml
<!-- Core -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />

<!-- Location (if using geofencing) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- Accessibility (opt-in) -->
<uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE" />

<!-- Optional -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.CALL_PHONE" />
<uses-permission android:name="android.permission.SEND_SMS" />
```

### App Structure

```
src/
  connection/
    WebSocketClient.kt
    MessageHandler.kt
    ReconnectionStrategy.kt

  tools/
    NotificationTool.kt
    LocationTool.kt
    IntentTool.kt
    AccessibilityTool.kt (optional)

  permissions/
    PermissionManager.kt
    PermissionRequestActivity.kt

  ui/
    MainActivity.kt (diagnostics)
    ConfirmationDialog.kt
    PermissionStatusScreen.kt

  services/
    DeviceAgentService.kt (foreground service)
    AccessibilityService.kt (optional)
```

## Server Components

### Device Management

- **DeviceSessionManager**: Track connected devices, capabilities, heartbeats
- **ToolProxy**: Route tool calls to appropriate device sessions
- **PolicyEngine**: Enforce allowlists, confirmations, rate limits

### Web Interface

- Device pairing flow with QR codes
- Device status dashboard (online/offline, permissions, capabilities)
- Manual tool testing panel
- Session routing (choose target device)
- Audit log viewer

## Execution Flow Examples

### Remote App Control

```
1. Desktop: "Open banking app on phone"
2. Server → Device: tool.invoke app.open { package: "com.bank.app" }
3. Device: Launches app, streams "opened" event
4. Optional: Follow-up accessibility commands to navigate
```

### Cross-User Notifications

```
1. Wife's session: "Send reminder to David's phone"
2. Server → David's device: tool.invoke notifications.send { title, body, actions }
3. Device: Shows notification with action buttons
4. David taps action → device.event → server → acknowledgment in wife's UI
```

### OTP Helper Automation

```
1. Device: Receives SMS with OTP → device.event { otp: "123456", app: "com.bank" }
2. Server: Matches pending login flow
3. Server → Device: tool.invoke a11y.type { text: "123456" }
4. Device: Types OTP into active field
```

## Development Roadmap

### Phase 1: Foundation

- Implement server WebSocket hub + device registry
- Build basic Android agent with connection management
- Add core tools: notifications, intents, location
- QR pairing and basic security

### Phase 2: Reliability

- Foreground service + diagnostics UI
- Confirmation flows + audit logging
- Error handling + reconnection logic
- Web dashboard for device management

### Phase 3: Advanced Automation

- Accessibility Service integration
- Policy engine with risk-based confirmations
- Geofencing and background events
- Multi-user session routing

### Phase 4: Expansion

- Additional tools (BLE, media, telephony)
- Desktop agent for multi-platform support
- Advanced scripting and macro recording
- Integration with existing MCP ecosystem

## Benefits

- **Zero UI Duplication**: No need to rebuild your entire web interface in Android
- **Multi-User Ready**: Support multiple users controlling the same device or multiple devices
- **Pluggable Architecture**: Easy to add new devices or capabilities
- **Secure by Design**: Explicit pairing, signed commands, audit trails
- **Platform Agnostic**: Protocol can extend to macOS, Windows, IoT devices

## Privacy and Ethics

Since this is designed for trusted, self-hosted use:

- Clear disclosure of all capabilities to users
- Easy on/off toggles for sensitive features
- Local processing of sensitive data when possible
- Comprehensive audit logs with rotation policies
- Respect for system security boundaries (FLAG_SECURE views, etc.)
