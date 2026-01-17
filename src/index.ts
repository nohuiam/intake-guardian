#!/usr/bin/env node
/**
 * Intake Guardian - MCP Server Entry Point
 *
 * Gate-keeper MCP server for content admission decisions.
 * Uses BBB redundancy scores and GNC-004 thresholds.
 *
 * Ports:
 * - MCP: stdio (stdin/stdout)
 * - InterLock UDP: 3023
 * - HTTP REST: 8023
 * - WebSocket: 9023
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { getDatabase } from './database/schema.js';
import { getIntakeService } from './services/intake-service.js';
import { HttpServer } from './http/server.js';
import { WebSocketService } from './websocket/server.js';
import { InterLockSocket, SIGNAL_TYPES } from './interlock/index.js';

// Tool handlers
import { CHECK_CONTENT_TOOL, handleCheckContent } from './tools/check-content.js';
import { CHECK_FILE_TOOL, handleCheckFile } from './tools/check-file.js';
import { ADMIT_CONTENT_TOOL, handleAdmitContent } from './tools/admit-content.js';
import { GET_HISTORY_TOOL, handleGetHistory } from './tools/get-history.js';
import { CONFIGURE_THRESHOLDS_TOOL, handleConfigureThresholds } from './tools/configure.js';

// Tools array (exported for HTTP gateway)
export const TOOLS = [
  CHECK_CONTENT_TOOL,
  CHECK_FILE_TOOL,
  ADMIT_CONTENT_TOOL,
  GET_HISTORY_TOOL,
  CONFIGURE_THRESHOLDS_TOOL
];

// Tool handlers map (exported for HTTP gateway)
export const TOOL_HANDLERS: Record<string, (args: any) => any> = {
  check_content: handleCheckContent,
  check_file: handleCheckFile,
  admit_content: handleAdmitContent,
  get_intake_history: handleGetHistory,
  configure_thresholds: handleConfigureThresholds
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load InterLock config
function loadInterLockConfig(): any {
  try {
    const configPath = join(__dirname, '..', 'config', 'interlock.json');
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {
      server_id: 'intake-guardian',
      port: 3023,
      http_port: 8023,
      websocket_port: 9023,
      accepted_signals: [],
      connections: {}
    };
  }
}

// Layer instances
let httpServer: HttpServer | null = null;
let wsServer: WebSocketService | null = null;
let interlock: InterLockSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

async function startLayers(): Promise<void> {
  const config = loadInterLockConfig();

  // Initialize database (getDatabase creates singleton)
  getDatabase();

  // Initialize intake service (getIntakeService creates singleton)
  getIntakeService();

  // Start HTTP server (Layer 3)
  httpServer = new HttpServer(config.http_port);
  await httpServer.start();

  // Start WebSocket server (Layer 4)
  wsServer = new WebSocketService(config.websocket_port);
  await wsServer.start();

  // Start InterLock mesh (Layer 2)
  interlock = new InterLockSocket({
    port: config.port,
    serverId: config.server_id,
    allowedSignals: config.accepted_signals || [],
    peers: Object.entries(config.connections || {}).map(([name, conn]: [string, any]) => ({
      name,
      host: conn.host,
      port: conn.port
    }))
  });

  // Register InterLock handlers
  interlock.on(SIGNAL_TYPES.HEARTBEAT, (msg, rinfo) => {
    console.error(`[InterLock] Heartbeat from ${msg.serverId}`);
  });

  interlock.on(SIGNAL_TYPES.HEALTH_CHECK, (msg, rinfo) => {
    interlock?.send(msg.serverId, SIGNAL_TYPES.HEALTH_RESPONSE, {
      status: 'healthy',
      server: config.server_id
    });
  });

  interlock.setDefaultHandler((msg, rinfo) => {
    console.error(`[InterLock] Received ${msg.type} from ${msg.serverId}`);
  });

  await interlock.start();

  // Start heartbeat timer
  heartbeatTimer = setInterval(() => {
    interlock?.sendHeartbeat();
  }, 30000);
  interlock?.sendHeartbeat(); // Send initial heartbeat

  // Wire up service events to WebSocket broadcasts
  const service = getIntakeService();
  // Service already broadcasts via wsServer internally

  console.error('[intake-guardian] All layers started');
}

async function stopLayers(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (interlock) await interlock.stop();
  if (wsServer) await wsServer.stop();
  if (httpServer) await httpServer.stop();
  // Database and service singletons clean up automatically
  console.error('[intake-guardian] All layers stopped');
}

async function main(): Promise<void> {
  // Start all layers
  await startLayers();

  // Create MCP server
  const server = new Server(
    {
      name: 'intake-guardian',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      CHECK_CONTENT_TOOL,
      CHECK_FILE_TOOL,
      ADMIT_CONTENT_TOOL,
      GET_HISTORY_TOOL,
      CONFIGURE_THRESHOLDS_TOOL
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'check_content':
          result = await handleCheckContent(args as any);
          // Broadcast via InterLock
          if (interlock && result && typeof result === 'object' && 'content_hash' in result) {
            const r = result as { content_hash: string; decision: string; redundancy_score: number };
            interlock.sendContentChecked(r.content_hash, r.decision, r.redundancy_score);
          }
          break;

        case 'check_file':
          result = await handleCheckFile(args as any);
          if (interlock && result && typeof result === 'object' && 'content_hash' in result) {
            const r = result as { content_hash: string; decision: string; redundancy_score: number };
            interlock.sendContentChecked(r.content_hash, r.decision, r.redundancy_score);
          }
          break;

        case 'admit_content':
          result = await handleAdmitContent(args as any);
          if (interlock && result && typeof result === 'object' && 'admission_id' in result) {
            const r = result as { admission_id: string; content_hash: string };
            interlock.sendContentAdmitted(r.content_hash, r.admission_id);
          }
          break;

        case 'get_intake_history':
          result = handleGetHistory(args as any);
          break;

        case 'configure_thresholds':
          result = handleConfigureThresholds(args as any);
          // Broadcast threshold update via WebSocket
          if (wsServer && result && typeof result === 'object') {
            wsServer.emitThresholdUpdated(result);
          }
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[intake-guardian] MCP server running on stdio');

  // Handle shutdown
  process.on('SIGINT', async () => {
    await stopLayers();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopLayers();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[intake-guardian] Fatal error:', error);
  process.exit(1);
});
