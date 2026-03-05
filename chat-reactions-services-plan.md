# Chat Reactions Implementation - Services Plan

## Overview

This document outlines the backend services that need to be modified to implement chat reactions in Decentraland, including message reactions, situation reactions, and avatar reactions.

---

## Core Services to Modify

### 1. `protocol` (Required - Foundation)
**Layer:** Shared Library  
**GitHub:** decentraland/protocol

**What to add:**
- New protobuf message definitions for:
  - `MessageReaction` - reaction to a specific chat message
  - `SituationReaction` - general reactions (floating emojis)
  - `AvatarReaction` - reactions shown above player avatars
- Add reaction types/emoji identifiers
- Define message IDs or message hashes to reference which message is being reacted to

**Why:** All real-time communication uses protocol buffers. This is the data contract between clients and servers.

---

### 2. `social-service-ea` (Required - Storage & API)
**Layer:** Feature Servers  
**GitHub:** decentraland/social-service-ea

**What to add:**
- **Database schema** for storing message reactions:
  - `message_reactions` table (message_id, user_address, emoji, timestamp, community_id)
  - Message history/tracking (currently messages aren't persisted - you'll need to add this)
- **REST API endpoints:**
  - `POST /v1/messages/{messageId}/reactions` - Add/update reaction
  - `DELETE /v1/messages/{messageId}/reactions` - Remove reaction
  - `GET /v1/messages/{messageId}/reactions` - Get all reactions for a message
  - `GET /v1/communities/{id}/situation-reactions` - Get recent situation reactions (if needed for metrics)
- **User settings:**
  - Add field to user preferences for "show/hide situation reactions"
  - Extend existing settings endpoints

**Why:** This is where social interactions are stored and managed. It already handles communities, friends, etc. Message reactions fit naturally here.

---

### 3. `comms-message-sfu` (Required - Real-time Broadcasting)
**Layer:** Realtime  
**GitHub:** decentraland/comms-message-sfu

**What to add:**
- **Message reaction routing:**
  - Accept reaction messages from clients via LiveKit
  - Validate the sender is in the same community/scene as the target message
  - Broadcast reaction to all members who can see that message
  - Handle situation reactions (broadcast to community members in the same location)
  - Handle avatar reactions (broadcast to nearby players)
- **Rate limiting:** 
  - Implement spam protection for situation reactions (as mentioned in rabbit holes)
  - Server-side throttling to prevent network flooding

**Why:** This service already routes chat messages between players in real-time. Reactions need the same real-time distribution mechanism.

---

## Optional Services (For Enhanced Features)

### 4. `archipelago-workers` (Optional - Location-based filtering)
**Layer:** Realtime  
**GitHub:** decentraland/archipelago-workers

**What to touch:**
- Possibly use for determining which players are in the same "island" for avatar reactions
- May already be handled by comms-message-sfu's existing logic

**Why:** If avatar reactions should only be visible to nearby players, this service tracks peer proximity.

---

### 5. Analytics/Metrics (Optional)
You mentioned tracking metrics:
- Messages reacted + emoji + source
- Situations reacted + emoji + location

This could be:
- Added to `social-service-ea` (store in database for later analysis)
- Or sent to an analytics service via events (if you have a separate analytics pipeline)

---

## Call Flow Examples

### Message Reaction Flow:
```
Unity Client → LiveKit → comms-message-sfu 
                            ↓ (validate & forward)
                         LiveKit → Other clients in community
                            ↓ (persist)
                         HTTP POST → social-service-ea API
                                      ↓
                                   Database (PostgreSQL)
```

### Situation Reaction Flow (Ephemeral):
```
Unity Client → LiveKit → comms-message-sfu
                            ↓ (rate limit & broadcast)
                         LiveKit → Community members in area
```

### Avatar Reaction Flow:
```
Unity Client → LiveKit → comms-message-sfu
                            ↓ (broadcast to nearby)
                         LiveKit → Nearby players
```

---

## Key Decisions Required

### 1. Message Persistence
Currently chat messages are NOT persisted. For message reactions to work, you need to:
- Either store message IDs temporarily (e.g., Redis with TTL for recent messages)
- Or assign client-generated message IDs and have clients track recent messages
- Or implement full chat history storage in social-service-ea

### 2. Reaction Visibility
- **Message reactions:** Permanent (stored in DB, visible to anyone who can see the message)
- **Situation reactions:** Ephemeral (real-time only, no persistence except for metrics)
- **Avatar reactions:** Ephemeral (real-time only)

### 3. Rate Limiting Strategy
- **Client-side:** Show all emojis to sender
- **Server-side:** Limit how many are broadcast (per rabbit holes note)

---

## Summary Table

| Service | Changes | Complexity |
|---------|---------|------------|
| `protocol` | Add protobuf definitions | Low |
| `social-service-ea` | Add DB schema + REST API + settings | **High** |
| `comms-message-sfu` | Add reaction routing + rate limiting | **Medium** |
| `archipelago-workers` | Optional (location filtering) | Low |

---

## Additional Notes

- The biggest lift is `social-service-ea` since it requires database schema changes and new API endpoints
- Message persistence is a prerequisite decision that affects the entire architecture
- Rate limiting for situation reactions is critical to prevent network flooding during live events

---

*Requested by Ignacio Mazzara via Slack*  
*Analysis date: March 3, 2026*
