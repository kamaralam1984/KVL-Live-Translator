import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:4319');
const results = [];

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', clientVersion: '0.1.0' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  results.push(msg);
  console.log('received:', msg);

  if (msg.type === 'welcome') {
    ws.send(JSON.stringify({ type: 'ping', ts: 12345 }));
  } else if (msg.type === 'pong') {
    ws.send(JSON.stringify({ type: 'session:start', sessionId: 'test-session-1', mode: 'hinglish' }));
  } else if (msg.type === 'session:started') {
    ws.send(
      JSON.stringify({
        type: 'providers:upsert',
        provider: { kind: 'translation', name: 'Test Provider', providerKey: 'openai', encryptedApiKey: Buffer.from('fake-encrypted-blob').toString('base64') },
      }),
    );
  } else if (msg.type === 'providers:data') {
    ws.send(JSON.stringify({ type: 'session:end', sessionId: 'test-session-1' }));
  } else if (msg.type === 'session:ended') {
    const types = results.map((r) => r.type);
    const expected = ['welcome', 'pong', 'session:started', 'providers:data', 'session:ended'];
    const ok = expected.every((t) => types.includes(t));
    console.log(ok ? '\nALL CHECKS PASSED' : '\nMISSING EXPECTED MESSAGES', types);
    ws.close();
    process.exit(ok ? 0 : 1);
  }
});

ws.on('error', (err) => {
  console.error('WS ERROR', err);
  process.exit(1);
});

setTimeout(() => {
  console.error('TIMEOUT waiting for full round trip');
  process.exit(1);
}, 8000);
