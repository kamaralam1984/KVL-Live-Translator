import { useEffect, useState } from 'react';
import type { ProviderConfigPublic, ProviderKind } from '@kvl/shared';
import { Badge, Button, Card } from '@kvl/ui';
import { onProvidersData, onProvidersTestResult, send } from '../services/wsClient';

const KIND_LABEL: Record<ProviderKind, string> = {
  stt: 'Speech-to-Text',
  translation: 'Translation',
  response: 'My Response',
  tts: 'Text-to-Speech',
  explanation: 'Explanation',
  copilot: 'Meeting Copilot',
  summary: 'Meeting Summary',
};

function randomRequestId(): string {
  return `test-${Math.random().toString(36).slice(2, 10)}`;
}

interface TestState {
  testing: boolean;
  ok?: boolean;
  message?: string;
}

export function ApiProviders() {
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([]);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [form, setForm] = useState({ kind: 'translation' as ProviderKind, name: '', providerKey: '', apiKey: '' });
  const [saving, setSaving] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [pendingTestRequests] = useState(() => new Map<string, string>()); // requestId -> providerId

  useEffect(() => {
    const unsubProviders = onProvidersData((message) => setProviders(message.providers));
    const unsubTestResult = onProvidersTestResult((message) => {
      const providerId = pendingTestRequests.get(message.requestId);
      if (!providerId) return;
      pendingTestRequests.delete(message.requestId);
      setTestStates((prev) => ({ ...prev, [providerId]: { testing: false, ok: message.ok, message: message.message } }));
    });
    send({ type: 'providers:list' });
    window.kvlAPI.isEncryptionAvailable().then(setEncryptionAvailable);
    return () => {
      unsubProviders();
      unsubTestResult();
    };
  }, [pendingTestRequests]);

  async function handleSave() {
    if (!form.name || !form.providerKey || !form.apiKey) return;
    setSaving(true);
    try {
      const encryptedApiKey = await window.kvlAPI.encryptSecret(form.apiKey);
      send({
        type: 'providers:upsert',
        provider: { kind: form.kind, name: form.name, providerKey: form.providerKey, encryptedApiKey, isActive: true },
      });
      setForm({ kind: form.kind, name: '', providerKey: '', apiKey: '' });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string) {
    send({ type: 'providers:delete', id });
  }

  /** Toggling active never re-sends the API key — the backend's upsert
   * keeps the existing encrypted key when encryptedApiKey is omitted (see
   * providersRepository.upsert's COALESCE). Enable = this becomes the one
   * active provider for its kind (the DB's unique-per-kind index handles
   * deactivating any previous one); Disable = falls back to Local for that
   * kind, same as never having configured it. */
  function handleToggleActive(provider: ProviderConfigPublic) {
    send({
      type: 'providers:upsert',
      provider: { id: provider.id, kind: provider.kind, name: provider.name, providerKey: provider.providerKey, isActive: !provider.isActive },
    });
  }

  function handleTestKey(provider: ProviderConfigPublic) {
    const requestId = randomRequestId();
    pendingTestRequests.set(requestId, provider.id);
    setTestStates((prev) => ({ ...prev, [provider.id]: { testing: true } }));
    send({ type: 'providers:test', requestId, providerId: provider.id });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">API Providers</h1>
        <p className="mt-1 text-[13px] text-muted">Configure speech, translation, and voice provider credentials.</p>
      </div>

      {!encryptionAvailable && (
        <Card className="border-danger/40 bg-danger/5">
          <p className="text-[12.5px] text-danger">
            Secure key storage is unavailable on this system (no OS keyring found). Saving provider keys is disabled.
          </p>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h4 className="text-[13.5px] font-bold">Add provider</h4>
        <div className="grid grid-cols-2 gap-3">
          <select
            className="rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ProviderKind }))}
          >
            <option value="stt">Speech-to-Text</option>
            <option value="translation">Translation</option>
            <option value="response">My Response</option>
            <option value="tts">Text-to-Speech</option>
            <option value="explanation">Explanation</option>
            <option value="copilot">Meeting Copilot</option>
            <option value="summary">Meeting Summary</option>
          </select>
          <input
            className="rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
            placeholder="Vendor (e.g. openai)"
            value={form.providerKey}
            onChange={(e) => setForm((f) => ({ ...f, providerKey: e.target.value }))}
          />
          <input
            className="col-span-2 rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
            placeholder="Label (e.g. My OpenAI account)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="col-span-2 rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
            placeholder="API key"
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
        </div>
        <Button variant="gold" disabled={!encryptionAvailable || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save provider'}
        </Button>
      </Card>

      <div className="flex flex-col gap-3">
        {providers.length === 0 ? (
          <Card className="py-8 text-center text-[12.5px] text-muted">No providers configured yet.</Card>
        ) : (
          providers.map((provider) => {
            const testState = testStates[provider.id];
            return (
              <Card key={provider.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{provider.name}</span>
                      <Badge variant="neutral">{KIND_LABEL[provider.kind]}</Badge>
                      {provider.isActive && <Badge variant="success">Active</Badge>}
                    </div>
                    <span className="text-[11.5px] text-muted">
                      {provider.providerKey} · key {provider.hasApiKey ? '•••• saved' : 'not set'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => handleTestKey(provider)} disabled={!provider.hasApiKey || testState?.testing}>
                      {testState?.testing ? 'Testing…' : 'Test key'}
                    </Button>
                    <Button variant="secondary" onClick={() => handleToggleActive(provider)}>
                      {provider.isActive ? 'Disable' : 'Enable'}
                    </Button>
                    <Button variant="ghost" onClick={() => handleDelete(provider.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
                {testState && !testState.testing && (
                  <p className={`text-[11.5px] ${testState.ok ? 'text-success' : 'text-danger'}`}>
                    {testState.ok ? 'Connection test succeeded.' : `Connection test failed${testState.message ? `: ${testState.message}` : '.'}`}
                  </p>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
