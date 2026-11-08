/**
 * Subscription protocol type definitions (interfaces only).
 * File is .ts by design: interface definitions only.
 */

export interface IssueRef {
  id: string;
  created_at?: number; // epoch ms
  updated_at?: number; // epoch ms
  closed_at?: number | null; // epoch ms or null
}

export interface Issue extends IssueRef {
  // Additional fields are server-defined; keep minimal here to guide clients.
  title?: string;
  status?: string;
  close_reason?: string | null;
  epic_id?: string | null;
  priority?: number;
  issue_type?: string;
  assignee?: string | null;
  labels?: string[];
  // Relationship fields for detail payloads
  dependencies?: DependencyRef[];
  dependents?: DependencyRef[];
}

export interface DependencyRef {
  id: string;
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  created_at?: number;
  updated_at?: number;
  closed_at?: number | null;
}

/**
 * One dependency edge of a `graph-issues` row: the row's bead depends on
 * `depends_on_id` with dependency type `type` (for example `blocks` or
 * `parent-child`). Edges are deduplicated per row.
 */
export interface GraphEdge {
  depends_on_id: string;
  type: string;
}

/**
 * A `graph-issues` row. The list is the open set (every bead except closed
 * and pinned ones) plus the beads outside it that open beads reference as a
 * parent or a dependency, which carry their real status (usually `closed`).
 */
export interface GraphIssue extends IssueRef {
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string | null;
  parent?: string | null;
  labels?: string[];
  dependencies: GraphEdge[];
}

export type SubscriptionType =
  | 'all-issues'
  | 'epics'
  | 'blocked-issues'
  | 'ready-issues'
  | 'in-progress-issues'
  | 'closed-issues'
  | 'issue-detail'
  | 'status-issues'
  | 'graph-issues';

export interface SubscribeParamsBase {
  /** Client-chosen subscription id (unique per connection). */
  id: string;
  /** Type of list to subscribe to. */
  type: SubscriptionType;
  /** Optional parameters for the list, e.g., epic_id or filters. */
  params?: Record<string, unknown>;
}

export interface SubscribeMessage extends SubscribeParamsBase {
  kind: 'subscribe';
}

export interface UnsubscribeMessage {
  kind: 'unsubscribe';
  id: string;
}

// Mutation messages are explicit and defined elsewhere in the protocol.
// There is no generic "mutate" command pipe from clients.

export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

export interface SnapshotMessage {
  kind: 'snapshot';
  id: string; // client subscription id
  revision: number; // strictly increasing per subscription
  issues: Issue[];
}

export interface UpsertMessage {
  kind: 'upsert';
  id: string;
  revision: number;
  issue: Issue;
}

export interface DeleteMessage {
  kind: 'delete';
  id: string;
  revision: number;
  issue_id: string;
}

export interface ErrorMessage {
  kind: 'error';
  id?: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ServerMessage =
  | SnapshotMessage
  | UpsertMessage
  | DeleteMessage
  | ErrorMessage;

export interface SubscriptionRegistryEntry {
  /** Deterministic key: type + serialized params */
  key: string;
  /** Fast-lookup map for diffing */
  itemsById: Map<string, IssueRef>;
  /** Active subscribers (connection-local ids) */
  subscribers: Set<string>;
  /** For metrics and observability (not used for TTL/GC) */
  lastRunAt?: number;
}
