import { createInterface } from 'node:readline/promises';
import { SIMULATED_BANNER } from '@gms/shared';
import { SimulatedAdapter } from './adapters/simulated-adapter';
import { Agent, SimulatedRelay, type AgentDisplay } from './agent';
import { BackendClient } from './backend-client';
import { AgentConfigError, loadAgentConfig, loadEnvFile } from './config';
import { Outbox } from './outbox';

/**
 * Agent CLI for the SIMULATED scanner (PLAN §6.2). Type commands to stand in for a thumb on the
 * scanner. Every result comes from the backend; the device key is never printed.
 */

const out = (line: string) => process.stdout.write(`${line}\n`);

const HELP = `Commands:
  scan SIM-0001     a fake thumb with this simulated ID
  nomatch           a finger the scanner cannot match
  error [CODE]      the scanner fails while reading
  health ok|error   set the simulated scanner health
  heartbeat         report health, upload offline denials, process deletions
  outbox            show how many offline denials are waiting
  help              this list
  quit              stop the agent`;

const consoleDisplay: AgentDisplay = {
  showResult(outcome) {
    const marker = outcome.granted ? 'OPEN ' : 'SHUT ';
    out(`[${marker}] ${outcome.title.toUpperCase()} — ${outcome.message}`);
    if (outcome.decision) out(`         reason ${outcome.decision.reason}, source ${outcome.decision.source}`);
    if (outcome.failure) out(`         backend: ${outcome.failure} (denial kept in the offline log)`);
  },
  info: (message) => out(`  ${message}`),
  warn: (message) => out(`  ! ${message}`),
};

async function main() {
  loadEnvFile();
  const config = loadAgentConfig();
  const adapter = new SimulatedAdapter();
  const client = new BackendClient(config);
  const outbox = new Outbox(config.outboxPath);
  const relay = new SimulatedRelay();
  const agent = new Agent({
    adapter,
    client,
    outbox,
    relay,
    display: consoleDisplay,
    heartbeatSeconds: config.heartbeatSeconds,
  });

  out(`*** ${SIMULATED_BANNER} ***`);
  out(`Device ${config.deviceId} → ${config.backendUrl}`);
  await agent.start();
  out(HELP);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'agent> ' });
  rl.prompt();
  for await (const raw of rl) {
    const [command = '', ...args] = raw.trim().split(/\s+/);
    try {
      switch (command.toLowerCase()) {
        case '':
          break;
        case 'scan':
          if (!args[0]) out('  Usage: scan SIM-0001');
          else adapter.scan(args[0]);
          break;
        case 'nomatch':
          adapter.noMatch();
          break;
        case 'error':
          adapter.fail(args[0]);
          break;
        case 'health':
          adapter.setHealth(
            args[0]?.toLowerCase() === 'error'
              ? { health: 'ERROR', errorCode: args[1] ?? 'SIMULATED_SCANNER_ERROR' }
              : { health: 'OK' },
          );
          out(`  Simulated scanner health: ${(await adapter.health()).health}`);
          break;
        case 'heartbeat': {
          const result = await agent.heartbeat();
          out(result.ok ? '  Heartbeat sent.' : '  Heartbeat failed.');
          break;
        }
        case 'outbox':
          out(`  ${(await outbox.read()).length} offline denial(s) waiting.`);
          break;
        case 'help':
          out(HELP);
          break;
        case 'quit':
        case 'exit':
          rl.close();
          break;
        default:
          out(`  Unknown command "${command}". Type help.`);
      }
      await agent.drain();
    } catch (error) {
      out(`  ! ${(error as Error).message}`);
    }
    rl.prompt();
  }
  await agent.stop();
  out(`Stopped. The simulated relay opened ${relay.openings} time(s).`);
}

main().catch((error: unknown) => {
  if (error instanceof AgentConfigError) {
    console.error(error.message);
  } else {
    console.error('The agent stopped unexpectedly:', (error as Error).message);
  }
  process.exitCode = 1;
});
