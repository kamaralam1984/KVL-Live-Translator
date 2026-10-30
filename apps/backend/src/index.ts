import { logger } from './logger';
import { migrate } from './db/migrate';
import { startWsServer } from './ws/server';
import { speechManager } from './speech/SpeechManager';
import { translationManager } from './translation/TranslationManager';
import { responseManager } from './response/ResponseManager';
import { ttsManager } from './tts/TtsManager';
import { explanationManager } from './explain/ExplanationManager';
import { copilotManager } from './copilot/CopilotManager';
import { summaryManager } from './summary/SummaryManager';
import { initTranscriptPersistence } from './summary/TranscriptPersistence';
import { initTranscriptRetentionSweep } from './summary/TranscriptRetention';
import { costManager } from './cost/CostManager';
import { costGate } from './cost/CostGate';
import { initUsageThresholdNotifier } from './cost/UsageThresholdNotifier';

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

function main() {
  migrate();
  const wss = startWsServer();

  // Fire-and-forget: must never delay the WS server coming up. Local Whisper
  // availability is just a filesystem check; the cloud provider's key-relay
  // round trip can take a few seconds and has nothing to do with binding
  // the port, so both run after the server is already listening.
  void speechManager.initialize().catch((error) => {
    logger.error({ err: error }, 'speech manager initialization failed');
  });
  void translationManager.initialize().catch((error) => {
    logger.error({ err: error }, 'translation manager initialization failed');
  });
  void responseManager.initialize().catch((error) => {
    logger.error({ err: error }, 'response manager initialization failed');
  });
  void ttsManager.initialize().catch((error) => {
    logger.error({ err: error }, 'tts manager initialization failed');
  });
  void explanationManager.initialize().catch((error) => {
    logger.error({ err: error }, 'explanation manager initialization failed');
  });
  void copilotManager.initialize().catch((error) => {
    logger.error({ err: error }, 'copilot manager initialization failed');
  });
  void summaryManager.initialize().catch((error) => {
    logger.error({ err: error }, 'summary manager initialization failed');
  });
  initTranscriptPersistence();
  initTranscriptRetentionSweep();
  costManager.refreshSettings();
  costGate.refreshSettings();
  initUsageThresholdNotifier();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
