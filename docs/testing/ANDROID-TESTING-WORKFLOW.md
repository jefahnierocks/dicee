---
title: Android Testing Workflow
category: Testing
component: Mobile QA Infrastructure
status: Active
version: 1.0.0
last_updated: 2025-12-15
tags: [android, adb, mobile-testing, chrome-devtools, logging]
priority: High
---

# Android Testing Workflow

Comprehensive mobile testing infrastructure for the Dicee web application on Android devices (Pixel 10 Pro XL) using macOS Tahoe (26.1) on M3 Max.

## Overview

This document defines:
1. **ADB Setup** - Android Debug Bridge installation and configuration
2. **Chrome DevTools** - Remote debugging for web applications
3. **Logcat Integration** - System-level log capture and analysis
4. **Zod Schemas** - Type-safe log entry parsing and validation
5. **Automation Scripts** - Fish shell functions for developer convenience

---

## Phase 1: ADB Installation (macOS Tahoe + M3 Max)

### Prerequisites

```bash
# Verify Homebrew is installed
brew --version

# If not installed:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install Android Platform Tools

```bash
# Install via Homebrew (recommended for global access)
brew install android-platform-tools

# Verify installation
adb --version
# Expected: Android Debug Bridge version 1.0.41+
```

### Configuration

```bash
# Add to PATH if needed (Fish shell)
fish_add_path /opt/homebrew/bin

# Verify ADB is accessible
which adb
# /opt/homebrew/bin/adb
```

---

## Phase 2: Device Connection

### macOS Security Configuration

macOS Tahoe has strict USB security. Configure before connecting:

1. **System Settings > Privacy & Security > Security**
2. Set "Allow accessories to connect" to:
   - "Ask for New Accessories" (recommended)
   - Or "Always" (less secure but convenient)

### Initial Connection

```bash
# Connect Pixel 10 Pro XL via USB-C

# 1. Start ADB server
adb kill-server && adb start-server

# 2. Check for device
adb devices
# List of devices attached
# XXXXXXXX    device

# 3. If "unauthorized", check phone for USB debugging prompt
#    - Check "Always allow from this computer"
#    - Tap "Allow"
```

### Wireless Debugging (Optional)

```bash
# Enable wireless debugging after initial USB connection
adb tcpip 5555
adb connect <device-ip>:5555

# Disconnect USB cable
# Verify wireless connection
adb devices
```

### Troubleshooting Connection Issues

```bash
# Reset ADB completely
adb kill-server
rm -rf ~/.android/adbkey*
adb start-server
adb devices

# Check USB connection
system_profiler SPUSBDataType | grep -A5 "Pixel"

# Verify Developer Options are enabled on device
# Settings > About Phone > Tap "Build Number" 7 times
# Settings > System > Developer options > USB debugging: ON
```

---

## Phase 3: Chrome Remote Debugging (Primary Method)

Chrome DevTools provides the best experience for web application debugging.

### Setup

1. **On Mac**: Open Chrome, navigate to `chrome://inspect/#devices`
2. **On Pixel**: Open Chrome, load your web app
3. **Verify**: Device appears in "Remote Target" list
4. **Inspect**: Click "inspect" next to the web app tab

### Port Forwarding (Local Development)

When testing against `localhost` on Mac:

```bash
# In chrome://inspect, click "Port forwarding"
# Add rules:
#   3000 → localhost:3000  (Vite dev server)
#   5173 → localhost:5173  (SvelteKit dev)
#   8787 → localhost:8787  (Wrangler DO worker)

# Or via ADB:
adb reverse tcp:3000 tcp:3000
adb reverse tcp:5173 tcp:5173
adb reverse tcp:8787 tcp:8787

# Verify port forwarding
adb reverse --list
```

### Production URL Testing

For testing against `dicee.games`:

1. Open Chrome on Pixel
2. Navigate to `https://dicee.games`
3. Inspect via `chrome://inspect` on Mac
4. Use Console, Network, and Performance tabs normally

---

## Phase 4: Logcat Integration (System-Level)

For system-level errors, crashes, and performance metrics.

### Filtered Log Streams

```bash
# Chrome/WebView logs only (verbose)
adb logcat -v color chromium:V *:S

# Chrome logs (debug level, less noise)
adb logcat -v color chromium:D *:S

# App crashes and ANRs
adb logcat -v color AndroidRuntime:E ActivityManager:W *:S

# Network-related logs
adb logcat -v color NetworkMonitor:D ConnectivityService:D *:S

# All errors (any app)
adb logcat -v color *:E

# Clear buffer and start fresh
adb logcat -c && adb logcat -v color chromium:D *:S
```

### Capture to File

```bash
# Create timestamped log directory
mkdir -p ~/Desktop/dicee-logs/$(date +%Y-%m-%d)

# Dump current buffer
adb logcat -d > ~/Desktop/dicee-logs/$(date +%Y-%m-%d)/buffer-dump.txt

# Stream to file (background)
adb logcat chromium:D *:S > ~/Desktop/dicee-logs/$(date +%Y-%m-%d)/chrome-$(date +%H%M%S).log &

# Full bug report (comprehensive)
adb bugreport ~/Desktop/dicee-logs/$(date +%Y-%m-%d)/bugreport.zip
```

### Log Priority Levels

| Level | Flag | Use Case |
|-------|------|----------|
| Verbose | V | Detailed debugging |
| Debug | D | Development logging |
| Info | I | General information |
| Warning | W | Potential issues |
| Error | E | Errors only |
| Fatal | F | Crash-level errors |
| Silent | S | Suppress output |

---

## Phase 5: Zod Schemas for Log Analysis

Type-safe schemas for parsing and validating device logs.

### Schema Location

```
packages/web/src/lib/types/device-testing.schema.ts
```

### Implementation

See `packages/web/src/lib/types/device-testing.schema.ts` for full implementation including:

- `DeviceInfoSchema` - Connected device metadata
- `LogEntrySchema` - Individual logcat entries
- `CaptureSessionSchema` - Log capture session tracking
- `ChromeConsoleSchema` - Chrome DevTools console messages
- `PerformanceMetricSchema` - Performance timing data
- `TestResultSchema` - Test execution results

---

## Phase 6: Fish Shell Convenience Functions

### Installation

```bash
# Copy to Fish functions directory
cp scripts/dicee-adb.fish ~/.config/fish/functions/

# Reload Fish
exec fish
```

### Available Commands

| Command | Description |
|---------|-------------|
| `dicee-adb status` | Check device connection status |
| `dicee-adb logs` | Stream Chrome logs (filtered) |
| `dicee-adb capture [name]` | Start named log capture session |
| `dicee-adb stop` | Stop active capture |
| `dicee-adb ports` | Setup port forwarding for local dev |
| `dicee-adb clear` | Clear port forwarding |
| `dicee-adb bugreport` | Generate full bug report |
| `dicee-adb inspect` | Open Chrome inspect page |

---

## Phase 7: Testing Workflow

### Pre-Test Checklist

```bash
# 1. Verify device connection
dicee-adb status

# 2. Setup port forwarding (if testing localhost)
dicee-adb ports

# 3. Start log capture session
dicee-adb capture "feature-xyz-test"

# 4. Open Chrome DevTools (optional)
dicee-adb inspect
```

### During Testing

1. **Chrome DevTools** (primary)
   - Console: JavaScript errors, warnings
   - Network: API calls, WebSocket connections
   - Performance: Frame timing, memory usage
   - Application: Storage, Service Workers

2. **Logcat** (secondary)
   - System-level errors
   - Browser crashes
   - Memory pressure events
   - Network connectivity changes

### Post-Test Analysis

```bash
# 1. Stop capture
dicee-adb stop

# 2. Find captured logs
ls -la ~/Desktop/dicee-logs/

# 3. Parse with Node.js utilities
pnpm web:analyze-logs ~/Desktop/dicee-logs/2025-12-15/feature-xyz.log
```

---

## Phase 8: Common Scenarios

### Debugging WebSocket Connection Issues

```bash
# Start log capture
dicee-adb capture "ws-debug"

# Filter for WebSocket-related logs
adb logcat -v time chromium:D *:S | grep -i "websocket\|ws:/\|wss:/"

# In Chrome DevTools:
# Network tab > WS filter > Check connection status
```

### Debugging Authentication Flow

```bash
# Monitor storage and network
dicee-adb capture "auth-debug"

# In Chrome DevTools:
# Application > Local Storage > Check tokens
# Network > Filter "supabase" > Check auth requests
```

### Performance Profiling

```bash
# Start performance capture
dicee-adb capture "perf-profile"

# In Chrome DevTools:
# Performance tab > Record > Perform actions > Stop

# Check memory
adb shell dumpsys meminfo com.android.chrome | grep -A20 "App Summary"
```

### Debugging Crash/ANR

```bash
# Get crash logs
adb logcat -d *:E | grep -A20 "FATAL\|ANR\|crash"

# Get full bug report
dicee-adb bugreport

# Check for tombstones (native crashes)
adb shell ls /data/tombstones/
```

---

## Phase 9: CI/CD Integration (Future)

### Automated Device Testing

For future CI/CD integration with physical device farm:

```yaml
# .github/workflows/mobile-test.yml (conceptual)
jobs:
  android-test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>
      - name: Setup ADB
        run: brew install android-platform-tools
      - name: Connect Device
        run: |
          adb devices
          adb wait-for-device
      - name: Run Tests
        run: pnpm test:e2e:mobile
      - name: Capture Logs
        if: failure()
        run: adb bugreport test-failure.zip
      - uses: actions/upload-artifact@<full-commit-sha>
        with:
          name: device-logs
          path: test-failure.zip
```

---

## Quick Reference

### Essential Commands

| Goal | Command |
|------|---------|
| Check connection | `adb devices` |
| Web debugging | `chrome://inspect` |
| Stream Chrome logs | `adb logcat chromium:D *:S` |
| Port forwarding | `adb reverse tcp:3000 tcp:3000` |
| Save bug report | `adb bugreport ~/Desktop/report.zip` |
| Restart ADB | `adb kill-server && adb start-server` |
| Clear logs | `adb logcat -c` |

### Device Info

| Property | Value |
|----------|-------|
| Device | Pixel 10 Pro XL |
| OS | Android (latest) |
| Mac | MacBook Pro M3 Max |
| macOS | Tahoe 26.1 |
| ADB | Homebrew (android-platform-tools) |

---

## References

- [Android Debug Bridge (ADB) Documentation](https://developer.android.com/tools/adb)
- [Chrome DevTools Remote Debugging](https://developer.chrome.com/docs/devtools/remote-debugging/)
- [Logcat Command Reference](https://developer.android.com/tools/logcat)
- [Enable Developer Options on Pixel](https://support.google.com/pixelphone/answer/6159206)
